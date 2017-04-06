var _ = require('lodash');
var Uuid = require('uuid');
var Pty = require('node-pty');
var Git = require('./git.js');
var Fs = require('fs');
var Path = require('path');
var Rimraf = require('rimraf');

class Server {
  constructor(options) {
    this._options = options;
    this._repoPath = Path.resolve(process.cwd(), options.git);

    this._sessions = [];
    this._branches = [];
    this._terminal = {};

    this._baseBranch = {
      name: options.baseBranch,
      commit: {}
    }
    this._targetBranch = {
      name: options.branch,
      processing: false,
      error: null,
      commits: [],
      updatedAt: null
    };
  }

  _tryCheck() {
    if (!this._checking) {
      this._checking = true;
      this._check()
        .then(() => {}, (error) => {
          this._broadcastError(error.message);
        }).then(() => {
          this._checking = false;
          if (this._checkPending) {
            this._checkPending = false;
            this._tryCheck();
          }
        });
      return;
    } else {
      this._checkPending = true;
    }
  }

  _check() {
    var gitRepo = new Git(this._repoPath);
    var remoteUrl;

    return Promise.resolve()
      .then(() => gitRepo.getRemotes(true))
      .then(data => {
        var remote = _.find(data, r => r.name == this._options.remote);
        if (!remote) return Promise.reject(new Error('Cannot find remote ' + this._options.remote));
        remoteUrl = remote.refs.fetch;
      })
      .then(() => gitRepo.fetch(this._options.remote))
      .then(() => gitRepo.remotePrune(this._options.remote))
      .then(() => gitRepo.log({
        from: 'remotes/' + this._options.remote + '/' + this._baseBranch.name + '~1',
        to: 'remotes/' + this._options.remote + '/' + this._baseBranch.name
      }))
      .then((data) => {
        this._baseBranch.commit = data.latest;
      })
      .then(() => gitRepo.branch())
      .then((data) => {
        var branchNames = [];
        for (var branchName in data.branches) {
          if (branchName.startsWith('remotes/' + this._options.remote + '/')) {
            branchNames.push(branchName.substring('remotes/'.length + this._options.remote.length + 1));
          }
        }

        var newBranchNames = branchNames.filter(n => !_.find(this._branches, (b) => b.name == n));
        var removeBranches = this._branches.filter(b => -1 == branchNames.indexOf(b.name));

        for (var newBranchName of newBranchNames) {
          this._branches.push({
            name: newBranchName,
            commits: [],
            active: false
          });
        }

        _.pull(this._branches, removeBranches);

        return Promise.all(
          this._branches.map(branch =>
            gitRepo.cherry(
              'remotes/' + this._options.remote + '/' + this._baseBranch.name,
              'remotes/' + this._options.remote + '/' + branch.name
            )
            .then(data => {
              branch.commits = data;
            })
          )
        );
      })
      .then(() => {
        this._broadcastStates();

        var targetCommits = [
          this._baseBranch.commit,
          ..._.flatten(
            this._branches
            .filter(b => b.active)
            .map(b => b.commits)
          )
        ];

        var cherryPickCommits = targetCommits.slice(1);


        if (_.isEqual(targetCommits.map(c => c.hash), this._targetBranch.commits.map(c => c.hash))) {
          this._targetBranch.error = null;
          this._broadcastStates();
        } else {
          var targetDir;
          return Promise.resolve()
            .then(() => {
              this._targetBranch.processing = true;
              this._broadcastStates();
            })
            .then(() =>
              new Promise((resolve, reject) => {
                Fs.mkdtemp('/tmp/gitty-cherry-picker-', (error, folder) => {
                  if (error) return reject(error);
                  targetDir = folder;
                  resolve();
                });
              })
            )
            .then(() => this._runTerminal('git', ['clone', remoteUrl, targetDir], targetDir))
            .then(() => cherryPickCommits.length &&
              this._runTerminal(
                'git', [
                  'cherry-pick',
                  '-x',
                  ...cherryPickCommits.map(c => c.hash)
                ],
                targetDir
              )
            )
            .then(() =>
              this._runTerminal(
                'git', [
                  'push',
                  '--force',
                  this._options.remote,
                  'HEAD:' + this._targetBranch.name
                ], targetDir
              )
            )
            .then(() => this._options.runCommand && this._runTerminal(this._options.runCommand, [], targetDir))
            .then(() => {
              this._targetBranch.processing = false;
              this._targetBranch.error = null;
              this._targetBranch.updatedAt = Date.now();
              this._targetBranch.commits = targetCommits;
              this._broadcastStates();
            }, error => {
              this._targetBranch.processing = false;
              this._targetBranch.error = error.message;
              this._broadcastError(error.message);
              this._broadcastStates();
            })
            .then(() => new Promise((resolve, reject) => {
              Rimraf(targetDir, (error) => {
                if (error) return reject(error);
                resolve();
              });
            }));
        }
      });
  }

  _doActionActivateBranch(parameters, session) {
    var branch = _.find(this._branches, (b) => b.name == parameters.branchName);
    if (!branch) return;

    branch.active = !branch.active;
    this._broadcastStates();
    this._tryCheck();
  }

  _doActionRecheck(parameters, session) {
    this._tryCheck();
  }

  _doActionInputTerminal(parameters, session) {
    if (this._terminalPty) {
      this._terminalPty.write(parameters.dataString);
    }
  }

  _sendTerminalOutput(dataString) {
    for (var session of this._sessions) {
      session.socket.send(JSON.stringify({
        terminalOutput: {
          dataString: dataString
        }
      }));
    }
  }

  _runTerminal(command, args, cwd) {
    if (this._terminal.command) {
      return new Promise(resolve => setTimeout(resolve, 500))
        .then(() => this._runTerminal(command, args, cwd));
    }

    this._terminal.command = command;
    this._terminal.args = args;
    this._terminal.cwd = cwd;
    this._sendTerminalOutput('\r\n' + cwd + '> ' + command + ' ' + args.join(' ') + '\r\n');
    this._broadcastStates();

    this._terminalPty = Pty.spawn(command, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: cwd
    });



    this._terminalPty.on('data', (data) => this._sendTerminalOutput(data));

    return new Promise((resolve, reject) => {
      this._terminalPty.on('exit', (code) => {
        this._terminalPty = null;
        this._sendTerminalOutput('\r\n' + cwd + '> ' + command + ' exited with: ' + code + '\r\n');

        this._terminal.command = null;
        this._terminal.args = null;
        this._terminal.cwd = null;

        this._broadcastStates();

        if (code) {
          return reject(new Error(command + ' exited with: ' + code));
        }

        resolve();
      });
    });
  }

  _broadcastStates() {
    for (var session of this._sessions) {
      session.socket.send(JSON.stringify({
        state: session.state
      }));
    }
  }

  _broadcastError(message) {
    for (var session of this._sessions) {
      session.socket.send(JSON.stringify({
        error: {
          message
        }
      }));
    }
  }

  handleWebSocket(socket) {
    var state = {
      branches: this._branches,
      baseBranch: this._baseBranch,
      targetBranch: this._targetBranch,
      terminal: this._terminal
    };

    var session = {
      state: state,
      socket: socket
    };

    this._sessions.push(session);
    this._broadcastStates();

    this._tryCheck();

    socket.on('message', (data) => {
      var action = JSON.parse(data);
      var actionFuncion = this['_doAction' + action.name];
      if (!actionFuncion) return this._broadcastError(action.name + ' doesn\'t exist.');
      actionFuncion.call(this, action.parameters, session);
    });

    socket.on('close', () => {
      _.pull(this._sessions, session);
      this._broadcastStates();
    });

  }
}

module.exports = Server;
