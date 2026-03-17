// Hello World — example agor plugin
agor.palette.registerCommand('Hello World', function() {
  agor.events.emit('notification', { type: 'info', message: 'Hello from the plugin marketplace!' });
});
