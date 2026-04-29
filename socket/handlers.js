module.exports = (io) => {
  io.on('connection', (socket) => {
    socket.on('join:admin', () => socket.join('admins'));
    socket.on('join:domiciliario', (id) => socket.join(`dom_${id}`));
  });
};
