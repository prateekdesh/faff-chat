document.addEventListener('DOMContentLoaded', function() {
    const userList = document.getElementById('user-list');
    const chatWindow = document.getElementById('chat-window');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');

    let currentUser = null;
    let currentRoom = null;
    let socket = null;
    let authToken = localStorage.getItem('authToken');
    let currentUserData = null;

    // Backend configuration
    const BACKEND_URL = 'http://localhost:3001';

    // DOM elements for auth
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const chatContainer = document.getElementById('chat-container');
    const authContainer = document.getElementById('auth-container');
    const logoutBtn = document.getElementById('logout-btn');
    const showRegisterBtn = document.getElementById('show-register');
    const showLoginBtn = document.getElementById('show-login');

    // Initialize the application
    initializeApp();

    function initializeApp() {
        if (authToken) {
            // User is logged in, show chat
            showChat();
            initializeSocket();
            fetchUsers();
        } else {
            // User needs to login/register
            showAuth();
        }
    }

    function showAuth() {
        if (authContainer) authContainer.style.display = 'block';
        if (chatContainer) chatContainer.style.display = 'none';
        if (loginForm) loginForm.style.display = 'block';
        if (registerForm) registerForm.style.display = 'none';
    }

    function showChat() {
        if (authContainer) authContainer.style.display = 'none';
        if (chatContainer) chatContainer.style.display = 'flex';
    }

    // Initialize Socket.IO connection
    function initializeSocket() {
        socket = io(BACKEND_URL);

        socket.on('connect', () => {
            // Authenticate socket connection
            if (authToken) {
                socket.emit('authenticate', authToken);
            }
        });

        socket.on('disconnect', () => {
        });

        // Listen for incoming messages
        socket.on('receive-message', (data) => {
            const type = data.sender.id === currentUserData.id ? 'sent' : 'received';
            const senderName = data.sender.name;
            displayMessage(data.message, senderName, type);
        });

        // Listen for errors
        socket.on('error', (data) => {
            alert(data.message || 'An error occurred');
        });

        socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            alert('Failed to connect to server. Please make sure the backend is running.');
        });
    }

    // Fetch users from backend
    async function fetchUsers() {
        try {
            const response = await fetch(`${BACKEND_URL}/api/users`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });
            const data = await response.json();

            if (data.success) {
                displayUsers(data.data);
            } else {
                console.error('Failed to fetch users:', data.error);
                alert('Failed to load users. Please try logging in again.');
                logout();
            }
        } catch (error) {
            console.error('Error fetching users:', error);
            alert('Failed to load users. Please try logging in again.');
            logout();
        }
    }

    // Display users in sidebar
    function displayUsers(users) {
        userList.innerHTML = '';
        // Filter out current user from the list
        const otherUsers = users.filter(user => user.id !== currentUserData.id);

        otherUsers.forEach(user => {
            const userElement = document.createElement('li');
            userElement.className = 'user';
            userElement.dataset.user = user.name;
            userElement.dataset.userId = user.id;
            userElement.innerHTML = `
                <span class="user-avatar">${user.name.charAt(0).toUpperCase()}</span>
                <span class="user-name">${user.name}</span>
                <span class="user-status online"></span>
            `;
            userList.appendChild(userElement);
        });
    }

    // Handle user selection
    userList.addEventListener('click', function(e) {
        const userElement = e.target.closest('.user');
        if (userElement) {
            // Remove active class from all users
            document.querySelectorAll('.user').forEach(user => user.classList.remove('active'));
            // Add active class to clicked user
            userElement.classList.add('active');

            currentUser = userElement.dataset.user;
            const otherUserId = userElement.dataset.userId;

            // Leave previous room if exists
            if (currentRoom && socket) {
                socket.emit('leave-room', currentRoom);
            }

            // Join the new chat room
            const newRoom = [currentUserData.id, otherUserId].sort().join('-');
            if (socket) {
                socket.emit('join-room', { otherUserId, roomId: newRoom });
            }
            currentRoom = newRoom;

            // Clear chat window for new conversation
            chatWindow.innerHTML = '';

            // Load previous messages for this conversation
            loadMessages(otherUserId);
        }
    });

    // Load messages for a conversation
    async function loadMessages(otherUserId) {
        try {
            const response = await fetch(`${BACKEND_URL}/api/messages?userId=${currentUserData.id}&otherUserId=${otherUserId}&limit=50`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });
            const data = await response.json();

            if (data.success) {
                // Reverse to show newest first, then prepend to put oldest at top
                data.data.reverse().forEach(msg => {
                    const type = msg.sender_id === currentUserData.id ? 'sent' : 'received';
                    const senderName = msg.sender ? msg.sender.name : 'Unknown';
                    displayMessage(msg.message, senderName, type, true);
                });
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    }

    // Display message in chat window
    function displayMessage(content, sender, type, prepend = false) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        messageElement.innerHTML = `<span class="sender">${sender}:</span>${content}`;
        if (prepend) {
            chatWindow.insertBefore(messageElement, chatWindow.firstChild);
        } else {
            chatWindow.appendChild(messageElement);
        }
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    // Show typing indicator
    function showTypingIndicator(user, isTyping) {
        let typingIndicator = document.getElementById('typing-indicator');

        if (isTyping) {
            if (!typingIndicator) {
                typingIndicator = document.createElement('div');
                typingIndicator.id = 'typing-indicator';
                typingIndicator.className = 'message received';
                typingIndicator.innerHTML = `<span class="sender">${user}:</span><em>is typing...</em>`;
                chatWindow.appendChild(typingIndicator);
            }
        } else {
            if (typingIndicator) {
                typingIndicator.remove();
            }
        }

        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    // Handle sending messages
    function sendMessage() {
        const messageText = messageInput.value.trim();
        if (messageText && currentUser && socket) {
            const otherUserId = document.querySelector('.user.active')?.dataset.userId;

            if (!otherUserId) {
                alert('Please select a user to chat with.');
                return;
            }

            // Send message via Socket.IO
            socket.emit('send-message', {
                receiver_id: otherUserId,
                message: messageText
            });

            // Clear input
            messageInput.value = '';

            // Stop typing indicator
            socket.emit('typing', {
                receiver_id: otherUserId,
                isTyping: false
            });
        } else if (!currentUser) {
            alert('Please select a user to chat with.');
        } else if (!socket) {
            alert('Not connected to server. Please refresh the page.');
        }
    }

    // Handle typing indicator
    let typingTimeout;
    messageInput.addEventListener('input', function() {
        if (currentUser && socket) {
            const otherUserId = document.querySelector('.user.active')?.dataset.userId;

            if (otherUserId) {
                socket.emit('typing', {
                    receiver_id: otherUserId,
                    isTyping: true,
                    userName: currentUserData.name
                });

                // Clear previous timeout
                clearTimeout(typingTimeout);

                // Stop typing after 1 second of inactivity
                typingTimeout = setTimeout(() => {
                    socket.emit('typing', {
                        receiver_id: otherUserId,
                        isTyping: false,
                        userName: currentUserData.name
                    });
                }, 1000);
            }
        }
    });

    // Authentication form handlers
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const formData = new FormData(this);
            const email = formData.get('email');
            const password = formData.get('password');

            try {
                const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();

                if (data.success) {
                    authToken = data.data.token;
                    currentUserData = data.data.user;
                    localStorage.setItem('authToken', authToken);
                    showChat();
                    initializeSocket();
                    fetchUsers();
                } else {
                    alert(data.error || 'Login failed');
                }
            } catch (error) {
                console.error('Login error:', error);
                alert('Login failed. Please try again.');
            }
        });
    }

    if (registerForm) {
        registerForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const formData = new FormData(this);
            const name = formData.get('name');
            const email = formData.get('email');
            const password = formData.get('password');

            try {
                const response = await fetch(`${BACKEND_URL}/api/auth/register`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ name, email, password })
                });

                const data = await response.json();

                if (data.success) {
                    authToken = data.data.token;
                    currentUserData = data.data.user;
                    localStorage.setItem('authToken', authToken);
                    showChat();
                    initializeSocket();
                    fetchUsers();
                } else {
                    alert(data.error || 'Registration failed');
                }
            } catch (error) {
                console.error('Registration error:', error);
                alert('Registration failed. Please try again.');
            }
        });
    }

    // Form switching
    if (showRegisterBtn) {
        showRegisterBtn.addEventListener('click', function(e) {
            e.preventDefault();
            loginForm.style.display = 'none';
            registerForm.style.display = 'block';
        });
    }

    if (showLoginBtn) {
        showLoginBtn.addEventListener('click', function(e) {
            e.preventDefault();
            registerForm.style.display = 'none';
            loginForm.style.display = 'block';
        });
    }

    // Logout functionality
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }

    function logout() {
        authToken = null;
        currentUserData = null;
        localStorage.removeItem('authToken');
        if (socket) {
            if (currentRoom) {
                socket.emit('leave-room', currentRoom);
                currentRoom = null;
            }
            socket.disconnect();
        }
        showAuth();
    }

    // Send button click
    sendButton.addEventListener('click', sendMessage);

    // Enter key press
    messageInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
});
