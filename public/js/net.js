export class Net {
  constructor(code, name, { onMessage, onClose }) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const qs = new URLSearchParams({ room: code, name });
    this.closedByUs = false;
    this.ws = new WebSocket(`${proto}://${location.host}/ws?${qs}`);
    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      onMessage(msg);
    };
    this.ws.onclose = (e) => onClose(e, this.closedByUs);
  }

  send(obj) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.closedByUs = true;
    this.ws.close();
  }
}
