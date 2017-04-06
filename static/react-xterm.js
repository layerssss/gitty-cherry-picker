class XTerm extends React.Component {
  constructor(props) {
    super(props);
  }

  write(dataString) {
    this._xterm.write(dataString);
  }

  componentDidMount() {
    this._xterm = new Terminal({
      cursorBlink: true
    });

    this._xterm.open(this.refs.container);
    this._xterm.on('data', (data) => {
      if (this.props.onData) this.props.onData(data);
    });
  }

  render() {
    return createElement(
      'div', {
        ref: 'container'
      }
    );
  }
}
