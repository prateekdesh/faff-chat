const express = require('express');
const prisma = require('../prisma/client');
const embeddingService = require('../services/embeddingService');

const router = express.Router();

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

    if (senderId === receiverId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot send messages to yourself'
      });
    }

    let embedding;
    try {
      embedding = await embeddingService.generateEmbedding(message.trim());
    } catch (error) {
      console.error('Embedding generation error:', error.message);
      embedding = null;
    }

    // Create the message with embedding
    console.log('Creating message, has embedding:', !!embedding);

    let newMessage;
    if (embedding) {
      console.log('Inserting with embedding using raw SQL...');
      try {
        // Convert embedding array to PostgreSQL vector format
        const vectorString = '[' + embedding.join(',') + ']';
        console.log('Vector string length:', vectorString.length);
        
        // Use raw SQL to ensure vector is stored correctly
        const result = await prisma.$queryRaw`
          INSERT INTO messages (id, sender_id, receiver_id, message, embedding, created_at)
          VALUES (gen_random_uuid(), ${senderId}, ${receiverId}, ${message.trim()}, ${vectorString}::vector, NOW())
          RETURNING id, sender_id, receiver_id, message, created_at
        `;
        newMessage = result[0];
        console.log('Raw SQL insert successful, message ID:', newMessage.id);
      } catch (sqlError) {
        console.error('Raw SQL insert failed:', sqlError.message);
        console.log('Falling back to Prisma create without embedding...');
        // Fallback to normal create without embedding
        newMessage = await prisma.message.create({
          data: {
            sender_id: senderId,
            receiver_id: receiverId,
            message: message.trim()
          }
        });
      }
    } else {
      console.log('Inserting without embedding...');
      newMessage = await prisma.message.create({
        data: {
          sender_id: senderId,
          receiver_id: receiverId,
          message: message.trim()
        }
      });
    }

    // Fetch the complete message with relations
    const completeMessage = await prisma.message.findUnique({
      where: { id: newMessage.id },
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
      data: completeMessage
    });

  } catch (error) {
    console.error('Message creation error:', error);
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

// GET /semantic-search?userId=abc123&q=search query → semantic search for user's messages
router.get('/semantic-search', async (req, res) => {
  try {
    const { userId, q } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId query parameter is required'
      });
    }

    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'q (query) parameter is required and cannot be empty'
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

    // Generate embedding for the search query
    let queryEmbedding;
    try {
      queryEmbedding = await embeddingService.generateEmbedding(q.trim());
    } catch (error) {
      console.error('Error generating query embedding:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to process search query'
      });
    }

    const messagesWithEmbeddings = await prisma.$queryRaw`
      SELECT COUNT(*) as total_messages,
             COUNT(m.embedding) as messages_with_embeddings
      FROM messages m
      WHERE m.sender_id = ${userId} OR m.receiver_id = ${userId}
    `;

    const similarMessages = await prisma.$queryRaw`
      SELECT
        m.id,
        m.message,
        m.created_at,
        m.sender_id,
        m.receiver_id,
        u_sender.name as sender_name,
        u_receiver.name as receiver_name,
        CASE
          WHEN m.embedding IS NOT NULL THEN 
            (1 - (m.embedding <=> ${queryEmbedding}::vector))
          ELSE 0.0
        END as score
      FROM messages m
      JOIN users u_sender ON m.sender_id = u_sender.id
      JOIN users u_receiver ON m.receiver_id = u_receiver.id
      WHERE m.sender_id = ${userId} OR m.receiver_id = ${userId}
      ORDER BY
        CASE
          WHEN m.embedding IS NOT NULL THEN 
            (m.embedding <=> ${queryEmbedding}::vector)
          ELSE 999999
        END
      LIMIT 10
    `;

    res.json({
      success: true,
      data: similarMessages,
      query: q.trim(),
      user: user
    });
  } catch (error) {
    console.error('Error performing semantic search:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform semantic search'
    });
  }
});

module.exports = router;
