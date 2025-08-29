const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const prisma = require('./prisma/client');
const embeddingService = require('./services/embeddingService');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
  credentials: true
}));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'FAFF Chat Backend Server is running!' });
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/messages', require('./routes/messages'));

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.email = decoded.email;
      console.log(`User ${socket.userId} authenticated via socket`);
    } catch (error) {
      console.error('Socket authentication failed:', error);
      socket.emit('unauthorized', { message: 'Authentication failed' });
      socket.disconnect();
    }
  });

  socket.on('join-room', (data) => {
    if (!socket.userId) {
      socket.emit('unauthorized', { message: 'Please authenticate first' });
      return;
    }

    const { otherUserId, roomId } = data;
    socket.join(roomId);
    console.log(`User ${socket.userId} joined room ${roomId}`);
    socket.emit('room-joined', { roomId });
  });

  socket.on('leave-room', (roomId) => {
    socket.leave(roomId);
    console.log(`User ${socket.userId} left room ${roomId}`);
  });

  socket.on('send-message', async (data) => {
    if (!socket.userId) {
      socket.emit('unauthorized', { message: 'Please authenticate first' });
      return;
    }

    try {
      const { receiver_id, message } = data;

      let embedding;
      try {
        embedding = await embeddingService.generateEmbedding(message.trim());
      } catch (error) {
        console.error('Embedding generation error:', error.message);
        embedding = null;
      }

      let newMessage;
      if (embedding) {
        try {
          const vectorString = '[' + embedding.join(',') + ']';
          const result = await prisma.$queryRaw`
            INSERT INTO messages (id, sender_id, receiver_id, message, embedding, created_at)
            VALUES (gen_random_uuid(), ${socket.userId}, ${receiver_id}, ${message.trim()}, ${vectorString}::vector, NOW())
            RETURNING id, sender_id, receiver_id, message, created_at
          `;

          const messageId = result[0].id;
          newMessage = await prisma.message.findUnique({
            where: { id: messageId },
            include: {
              sender: {
                select: { id: true, name: true }
              },
              receiver: {
                select: { id: true, name: true }
              }
            }
          });
        } catch (sqlError) {
          console.error('Raw SQL insert failed:', sqlError.message);
          newMessage = await prisma.message.create({
            data: {
              sender_id: socket.userId,
              receiver_id,
              message: message.trim()
            },
            include: {
              sender: {
                select: { id: true, name: true }
              },
              receiver: {
                select: { id: true, name: true }
              }
            }
          });
        }
      } else {
        newMessage = await prisma.message.create({
          data: {
            sender_id: socket.userId,
            receiver_id,
            message: message.trim()
          },
          include: {
            sender: {
              select: { id: true, name: true }
            },
            receiver: {
              select: { id: true, name: true }
            }
          }
        });
      }

      const roomId = [socket.userId, receiver_id].sort().join('-');
      io.to(roomId).emit('receive-message', newMessage);

    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('typing', (data) => {
    if (!socket.userId) return;

    const { receiver_id, isTyping, userName } = data;
    const roomId = [socket.userId, receiver_id].sort().join('-');

    socket.to(roomId).emit('user-typing', {
      user: userName,
      isTyping
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
