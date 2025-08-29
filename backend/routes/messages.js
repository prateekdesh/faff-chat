const express = require('express');
const prisma = require('../prisma/client');

const router = express.Router();

// POST /messages → send a message { senderId, receiverId, message }
router.post('/', async (req, res) => {
  try {
    const { senderId, receiverId, message } = req.body;

    if (!senderId || !receiverId || !message) {
      return res.status(400).json({
        success: false,
        error: 'senderId, receiverId, and message are required'
      });
    }

    if (message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message cannot be empty'
      });
    }

    // Verify sender exists
    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { id: true, name: true }
    });

    if (!sender) {
      return res.status(404).json({
        success: false,
        error: 'Sender not found'
      });
    }

    // Verify receiver exists
    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, name: true }
    });

    if (!receiver) {
      return res.status(404).json({
        success: false,
        error: 'Receiver not found'
      });
    }

    // Prevent sending messages to yourself
    if (senderId === receiverId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot send messages to yourself'
      });
    }

    // Create the message
    const newMessage = await prisma.message.create({
      data: {
        sender_id: senderId,
        receiver_id: receiverId,
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

    res.status(201).json({
      success: true,
      data: newMessage
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message'
    });
  }
});

// GET /messages?userId=abc123&limit=99 → fetch recent chats for a user
router.get('/', async (req, res) => {
  try {
    const { userId, otherUserId, limit = 50 } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId query parameter is required'
      });
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    let whereCondition = {
      OR: [
        { sender_id: userId },
        { receiver_id: userId }
      ]
    };

    if (otherUserId) {
      whereCondition = {
        OR: [
          { sender_id: userId, receiver_id: otherUserId },
          { sender_id: otherUserId, receiver_id: userId }
        ]
      };
    }

    // Get recent messages for the user (both sent and received)
    const messages = await prisma.message.findMany({
      where: whereCondition,
      include: {
        sender: {
          select: { id: true, name: true }
        },
        receiver: {
          select: { id: true, name: true }
        }
      },
      orderBy: [
        { created_at: 'asc' },
        { id: 'asc' }
      ],
      take: parseInt(limit)
    });

    res.json({
      success: true,
      data: messages,
      user: user
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch messages'
    });
  }
});

module.exports = router;
