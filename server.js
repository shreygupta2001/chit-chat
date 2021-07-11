// backend file using node.js and express.js as the server

//importing the required dependencies
const twilio = require('twilio');
const cors = require('cors');
const express = require('express');
const socket = require('socket.io');
const groupCallHandler = require('./groupCallHandler');
const { ExpressPeerServer } = require('peer');
const { v4: uuidv4 } = require('uuid');

//default port
const PORT = process.env.PORT || 5000;

const app = express();

app.use(cors());

app.get('/', (req, res) => {
     res.send({ api: 'chitchat-api'});
})

app.get('/api/get-turn-credentials', (req, res) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    const client = twilio(accountSid, authToken);

    client.tokens.create().then ((token) => res.send({token}));
})

//function that defines server is listening on mentioned port
const server = app.listen(PORT, () => {
    console.log(`server is listening on port ${PORT}`);
});

//peer server for group calling
const peerServer = ExpressPeerServer(server, {
    debug: true
});

app.use('/peerjs', peerServer);

groupCallHandler.createPeerServerListeners(peerServer);

//function defining that server uses socket.io
const io = socket(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

//store active Users
let peers = [];

let groupCallRooms = [];

const broadcastEventTypes = {
    ACTIVE_USERS: 'ACTIVE_USERS',
    GROUP_CALL_ROOMS: 'GROUP_CALL_ROOMS'
};

// Callback on event of connection: socket emits that user is connected
io.on('connection', (socket) => {
    socket.emit('connection', null);
    console.log('new user connected');

    //listener function when a new user enters, storing its username and id
    socket.on('register-new-user', (data) => {
        peers.push({
            username: data.username,
            socketId: data.socketId
        });
        console.log('registered new user');

        //broadcast list of all active users to all users connected to server
        io.sockets.emit('broadcast', {
            event: broadcastEventTypes.ACTIVE_USERS,
            activeUsers: peers
        });

        //broadcast list of all rooms to all users connected to server
        io.sockets.emit('broadcast', {
            event: broadcastEventTypes.GROUP_CALL_ROOMS,
            groupCallRooms
        });
    });

    //event emitted from client server if the user is disconnected
    socket.on('disconnect', () => {
        console.log('user disconnected');

        //filter list of active users to remove inactive users and
        //broadcast new list of peers
        peers = peers.filter((peer) => peer.socketId !== socket.id);
        io.sockets.emit('broadcast', {
            event: broadcastEventTypes.ACTIVE_USERS,
            activeUsers: peers
        });

        groupCallRooms = groupCallRooms.filter((room) => room.socketId !== socket.id);
        io.sockets.emit('broadcast', {
            event: broadcastEventTypes.GROUP_CALL_ROOMS,
            groupCallRooms
        });
    });

    // event listeners for direct call - sending pre offer
    socket.on('pre-offer', (data) => {
        io.to(data.callee.socketId).emit('pre-offer', {
            callerUsername: data.caller.username,
            callerSocketId: socket.id
        });
    });

    // event listener for pre-offer answer
    socket.on('pre-offer-answer', (data) => {
        io.to(data.callerSocketId).emit('pre-offer-answer', {
            answer: data.answer
        });
    });

    //event listener for webRTC offer
    socket.on('webRTC-offer', (data) => {
        io.to(data.calleeSocketId).emit('webRTC-offer', {
            offer: data.offer
        });
    });

    //event listener for webRTC answer
    socket.on('webRTC-answer', (data) => {
        io.to(data.callerSocketId).emit('webRTC-answer', {
            answer: data.answer
        });
    });

    //event listener on webRTC ice candidate exchange
    socket.on('webRTC-candidate', (data) => {
        io.to(data.connectedUserSocketId).emit('webRTC-candidate', {
            candidate: data.candidate
        });
    });

    //event listener when user hangs up
    socket.on('user-hanged-up', (data) => {
        io.to(data.connectedUserSocketId).emit('user-hanged-up');
    });

    //event listener related to group call register
    socket.on('group-call-register', (data) => {
        const roomId = uuidv4();
        socket.join(roomId);

        const newGroupCallRoom = {
            peerId: data.peerId,
            hostName: data.username,
            socketId: socket.id,
            roomId: roomId
        };

        //adding newly created room to the list of rooms
        groupCallRooms.push(newGroupCallRoom);

        //broadcasting list of rooms to all users
        io.sockets.emit('broadcast', {
            event: broadcastEventTypes.GROUP_CALL_ROOMS,
            groupCallRooms
        });
    });

    //listener for joining group call request
    socket.on('group-call-join-request', (data) => {
        io.to(data.roomId).emit('group-call-join-request', {
            peerId: data.peerId,
            streamId: data.streamId
        });

        socket.join(data.roomId);
    });

    //listener for user leaving group call
    socket.on('group-call-user-left', (data) => {
        socket.leave(data.roomId);

        io.to(data.roomId).emit('group-call-user-left', {
            streamId: data.streamId
        });
    });

    //listener event when group call is closed by host
    socket.on('group-call-closed-by-host', (data) => {
        groupCallRooms = groupCallRooms.filter((room) => room.peerId !== data.peerId);

        io.sockets.emit('broadcast', {
            event: broadcastEventTypes.GROUP_CALL_ROOMS,
            groupCallRooms
        });
    });
});