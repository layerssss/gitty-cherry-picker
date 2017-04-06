var {
  Alert,
  Modal,
  Navbar,
  Grid,
  Col,
  Button,
  ButtonGroup,
  Accordion,
  Panel,
  PanelGroup,
  ListGroup,
  ListGroupItem,
  Tabs,
  Tab,
  ProgressBar
} = ReactBootstrap;

var {
  createElement
} = React;

class CherryPicker extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      loaded: false,
      errors: []
    };
  }

  doAction(name, parameters) {
    if (!this.state.loaded) return;

    this.socket.send(JSON.stringify({
      name: name,
      parameters: parameters
    }));
  }

  componentDidMount() {
    var initSocket = () => {
      this.socket = new WebSocket(location.origin.replace(/^http/, 'ws'));

      this.socket.onmessage = (messageEvent) => {
        var {
          state,
          error,
          terminalOutput
        } = JSON.parse(messageEvent.data);

        if (state) {
          this.setState(state);
          this.setState({
            loaded: true,
            tries: 0
          });
        }

        if (error) {
          this.state.errors.push(error);
          this.forceUpdate();
        }

        if (terminalOutput) {
          if (this.refs.xTerm) {
            this.refs.xTerm.write(terminalOutput.dataString);
          }
        }
      };

      this.socket.onerror = (errorEvent) => {
        this.state.errors.push({
          message: 'WebSocket connection failed.'
        });

        this.setState({
          loaded: false
        });
      };

      this.socket.onclose = () => {
        this.setState({
          loaded: false,
        });

        setTimeout(initSocket, 1000);
      };
    }

    initSocket();
  }

  componentWillUnmount() {
    this.socket.close();
  }

  render() {
    if (this.state.loaded) {
      document.title = 'CherryPicking';
    }

    var error = this.state.errors[0];

    return createElement(
      'div', {
        className: 'cherry_picker',
        style: {
          padding: '2em 0'
        }
      },
      (this.state.loaded &&
        createElement(
          Grid, {
            fluid: true
          },
          createElement(
            Col, {
              md: 6
            },
            createElement(
              Tabs, {
                defaultActiveKey: 1,
                accordion: true,
                bsStyle: 'pills',
                className: 'main_nav'
              },
              createElement(
                Tab, {
                  title: 'Active branches',
                  eventKey: 1
                },
                (this.state.targetBranch.error &&
                  createElement(
                    Alert, {
                      bsStyle: 'danger'
                    },
                    "The most recent cherry-picking wasn't successful: " + this.state.targetBranch.error
                  )
                ),
                createElement(
                  'p', {
                    className: 'clearfix'
                  },
                  createElement(
                    'span', {
                      className: 'pull-right'
                    },
                    createElement(
                      Button, {
                        bsSize: 'small',
                        onClick: () => {
                          this.doAction('Recheck');
                        }
                      },
                      'Re-check'
                    )
                  ),
                  'Target branch: ' + this.state.targetBranch.name
                ),
                (this.state.targetBranch.processing ?
                  createElement(
                    ProgressBar, {
                      active: true,
                      now: 100
                    }
                  ) :
                  (this.state.targetBranch.error ? '' : createElement(
                    'div', {},
                    createElement(
                      'p', {},
                      'Updated at: ' + moment(this.state.targetBranch.updatedAt).toString() +
                      ' (' + moment(this.state.targetBranch.updatedAt).fromNow() + ')'
                    ),
                    createElement(
                      Panel, {
                        header: 'Branches'
                      },
                      createElement(
                        ListGroup, {
                          fill: true
                        },
                        this.state.branches.filter(b => b.active).map(branch =>
                          createElement(
                            ListGroupItem, {},
                            branch.name
                          )
                        )
                      )
                    )
                  ))
                )
              ),
              createElement(
                Tab, {
                  title: 'All branches',
                  eventKey: 2
                },
                this.state.branches.map(branch =>
                  createElement(
                    Panel, {
                      header: branch.name,
                      bsStyle: (branch.active ? 'success' : 'default')
                    },
                    createElement(
                      'div', {
                        className: 'pull-right'
                      },
                      createElement(
                        ReactBootstrapToggle, {
                          active: branch.active,
                          onstyle: 'success',
                          onClick: (ev) => {
                            this.doAction('ActivateBranch', {
                              branchName: branch.name
                            });
                          }
                        }
                      )
                    ),
                    (branch.commits.length ? createElement(
                      'ul', {},
                      branch.commits.map(commit =>
                        createElement(
                          'li', {
                            key: commit.hash
                          },
                          commit.message
                        )
                      )
                    ) : '')
                  )
                )
              )
            )
          ),
          createElement(
            Col, {
              md: 6
            },
            createElement(
              Panel, {
                header: 'Running: ' + (this.state.terminal.command || ''),
                bsStyle: (this.state.terminal.command ? 'info' : 'default'),
                className: 'terminal_panel'
              },
              createElement(
                XTerm, {
                  ref: 'xTerm',
                  onData: (data) => {
                    this.doAction('InputTerminal', {
                      dataString: data
                    });
                  }
                }
              )
            )
          )
        )
      ),
      (error &&
        createElement(
          Modal, {
            show: !error.dismissed,
            onHide: () => {
              error.dismissed = true;
              this.forceUpdate();
            },
            onExited: () => {
              _.defer(() => {
                _.pull(this.state.errors, error);
                this.forceUpdate();
              });
            }
          },
          createElement(
            Modal.Header, {
              closeButton: true
            },
            createElement(
              Modal.Title, {},
              'Error'
            )
          ),
          createElement(
            Modal.Body, {},
            error.message
          )
        )
      )
    )
  }
}

var root = document.createElement('div');
document.body.appendChild(root);

ReactDOM.render(
  createElement(CherryPicker, {}),
  root
);
