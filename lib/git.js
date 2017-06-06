var SimpleGit = require('simple-git');

class Git {
  constructor(path) {
    this._simpleGit = SimpleGit(path);

    ['fetch', 'branch', 'log', 'checkout', 'getRemotes'].forEach((action) => {
      this[action] = (...args) => this._action(action, ...args);
    });
  }

  cherry(upstream, head) {
    return this._action('raw', ['cherry', '--verbose', upstream, head])
      .then(data => {
        data = data || '';

        return data.split('\n').map(line => {
          var match = line.match(/^\+\s+(\w+)\s+(.*)$/);
          return match && {
            hash: match[1],
            message: match[2]
          };
        }).filter(commit => commit)
      });
  }

  _action(action, ...args) {
    if (this._actionRunning) {
      return new Promise((resolve) => setTimeout(resolve, 10))
        .then(() => this._action(action, ...args));
    }
    return new Promise((resolve, reject) => {
      this._actionRunning = true;
      this._simpleGit[action](...args, (error, data) => {
        setTimeout(() => {
          this._actionRunning = false;
        }, 1);

        if (error) return reject(error);

        resolve(data);
      });
    });
  }
}

module.exports = Git;
