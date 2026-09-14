const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const roomGames = {};

function createDeck() {
  const suits = ['espadas', 'copas', 'oros', 'bastos'];
  const deck = [];

  suits.forEach(suit => {
    for (let value = 1; value <= 12; value++) {
      deck.push({
        id: `\({value}_\){suit}`,
        suit: suit,
        value: value,
        points: (value === 12) ? -1 : value
      });
    }
  });

  deck.push({ id: 'joker_1', suit: 'joker', value: 0, points: -2 });
  deck.push({ id: 'joker_2', suit: 'joker', value: 0, points: -2 });

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function calculateScore(cards) {
  return cards.reduce((sum, card) => sum + (card.points !== undefined ? card.points : card.value), 0);
}

function checkAndHandleGameOver(room, roomId, reason = '') {
  let gameOver = false;
  let triggerPlayerName = '';

  for (const socketId in room.players) {
    if (room.players[socketId].cards.length === 0) {
      gameOver = true;
      triggerPlayerName = room.players[socketId].name;
      reason = `¡${triggerPlayerName} se ha quedado sin cartas!`;
      break;
    }
  }

  if (!gameOver && room.deck.length === 0 && room.discardPile.length <= 1) {
    gameOver = true;
    reason = 'No quedan más cartas en el mazo para continuar.';
  }

  if (gameOver) {
    room.state = 'GAME_OVER';

    const scoreboard = Object.values(room.players).map(p => {
      const totalPoints = calculateScore(p.cards);
      return {
        socketId: p.socketId,
        name: p.name,
        cards: p.cards,
        score: totalPoints
      };
    });

    scoreboard.sort((a, b) => a.score - b.score);

    io.to(roomId).emit('gameOverEvent', {
      reason: reason,
      scoreboard: scoreboard
    });

    return true;
  }

  return false;
}

function advanceTurn(room, roomId) {
  // 1. LIMPIAR ESTADOS DEL TURNO ANTERIOR (CORRECCIÓN CLAVE)
  room.drawnCard = null;
  room.drawnFrom = null;
  room.pendingEffect = null;
  room.state = 'PLAYING';

  if (checkAndHandleGameOver(room, roomId)) return;

  // 2. Avanzar al siguiente jugador en la lista
  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.playerOrder.length;
  const currentTurnSocketId = room.playerOrder[room.currentTurnIndex];

  // Log para depuración en Render
  console.log(`[LOG SUT] Cambio de turno en \({roomId}. Siguiente jugador:\){room.players[currentTurnSocketId].name}`);

  io.to(roomId).emit('turnUpdated', {
    currentTurnSocketId: currentTurnSocketId,
    topDiscard: room.discardPile[room.discardPile.length - 1],
    cardsInDeck: room.deck.length
  });
}

function broadcastBoardUpdate(room, roomId) {
  const publicPlayers = room.playerOrder.map(pId => ({
    socketId: pId,
    name: room.players[pId].name,
    cardCount: room.players[pId].cards.length,
    cards: room.players[pId].cards
  }));

  io.to(roomId).emit('boardStateUpdated', {
    players: publicPlayers,
    topDiscard: room.discardPile[room.discardPile.length - 1],
    cardsInDeck: room.deck.length
  });
}

io.on('connection', (socket) => {

  // CREAR SALA (ADMIN DEFINE EL PIN DE ACCESO)
  socket.on('createRoom', ({ maxPlayers, roomPin }, callback) => {
    if (!roomPin || roomPin.trim() === '') {
      return callback({ success: false, message: 'Debes definir un PIN o clave para la sala.' });
    }

    const roomId = 'SALA-' + Math.floor(1000 + Math.random() * 9000);

    roomGames[roomId] = {
      adminId: socket.id,
      maxPlayers: parseInt(maxPlayers),
      roomPin: roomPin.trim(),
      players: {},
      state: 'LOBBY',
      deck: [],
      discardPile: [],
      currentTurnIndex: 0,
      playerOrder: [],
      peekedPlayers: new Set(),
      drawnCard: null,
      drawnFrom: null,
      pendingEffect: null
    };

    socket.join(roomId);
    callback({ success: true, roomId: roomId, roomPin: roomPin.trim() });
  });

  // UNIRSE A LA SALA (DOBLE VERIFICACIÓN: SALA + PIN)
  socket.on('joinRoom', ({ roomId, playerName, pin }, callback) => {
    const room = roomGames[roomId];

    if (!room) return callback({ success: false, message: 'La sala no existe.' });
    if (room.roomPin !== pin.trim()) return callback({ success: false, message: 'PIN de acceso incorrecto.' });
    if (Object.keys(room.players).length >= room.maxPlayers) {
      return callback({ success: false, message: 'La sala ya está llena.' });
    }

    room.players[socket.id] = {
      socketId: socket.id,
      name: playerName,
      cards: []
    };

    socket.join(roomId);

    io.to(roomId).emit('roomUpdated', {
      maxPlayers: room.maxPlayers,
      roomPin: room.roomPin,
      connectedPlayers: Object.values(room.players).map(p => p.name)
    });

    callback({ success: true, roomId: roomId, isAdmin: socket.id === room.adminId });
  });

  // CONFIGURACIÓN E INICIO DE PARTIDA
  const setupAndStartGame = (roomId) => {
    const room = roomGames[roomId];
    const playerIds = Object.keys(room.players);

    const deck = createDeck();
    playerIds.forEach(id => {
      room.players[id].cards = deck.splice(0, 6);
    });

    const initialDiscard = deck.pop();

    room.deck = deck;
    room.discardPile = [initialDiscard];
    room.state = 'PEEK_PHASE';
    room.playerOrder = playerIds;
    room.currentTurnIndex = 0;
    room.peekedPlayers = new Set();
    room.drawnCard = null;

    playerIds.forEach(id => {
      const playerSocket = io.sockets.sockets.get(id);
      if (playerSocket) {
        const publicPlayers = playerIds.map(pId => ({
          socketId: pId,
          name: room.players[pId].name,
          cardCount: room.players[pId].cards.length,
          cards: pId === id ? room.players[id].cards : Array(room.players[pId].cards.length).fill(null)
        }));

        playerSocket.emit('gameStarted', {
          players: publicPlayers,
          topDiscard: initialDiscard,
          cardsInDeck: room.deck.length,
          gameState: 'PEEK_PHASE'
        });
      }
    });
  };

  socket.on('startGame', ({ roomId }, callback) => {
    const room = roomGames[roomId];
    if (!room || socket.id !== room.adminId) {
      return callback({ success: false, message: 'No tienes permiso para iniciar.' });
    }
    if (Object.keys(room.players).length < 2) {
      return callback({ success: false, message: 'Se necesitan al menos 2 jugadores.' });
    }

    setupAndStartGame(roomId);
    callback({ success: true });
  });

  socket.on('restartGame', ({ roomId }, callback) => {
    const room = roomGames[roomId];
    if (!room || socket.id !== room.adminId) {
      return callback({ success: false, message: 'Solo el admin puede reiniciar.' });
    }

    setupAndStartGame(roomId);
    callback({ success: true });
  });

  // INSPECCIÓN INICIAL
  socket.on('peekInitialCard', ({ roomId, cardIndex }, callback) => {
    const room = roomGames[roomId];
    if (!room || room.state !== 'PEEK_PHASE') {
      return callback({ success: false, message: 'No es la fase de inspección inicial.' });
    }

    if (room.peekedPlayers.has(socket.id)) {
      return callback({ success: false, message: 'Ya miraste tu carta.' });
    }

    const player = room.players[socket.id];
    if (!player || cardIndex < 0 || cardIndex >= player.cards.length) {
      return callback({ success: false, message: 'Posición inválida.' });
    }

    room.peekedPlayers.add(socket.id);
    callback({ success: true, card: player.cards[cardIndex] });

    if (room.peekedPlayers.size === Object.keys(room.players).length) {
      room.state = 'PLAYING';
      io.to(roomId).emit('startTurnPhase', {
        currentTurnSocketId: room.playerOrder[room.currentTurnIndex]
      });
    }
  });

  // ROBAR CARTA
  socket.on('drawCard', ({ roomId, source }, callback) => {
    const room = roomGames[roomId];
    if (!room || room.state !== 'PLAYING' || socket.id !== room.playerOrder[room.currentTurnIndex]) {
      return callback({ success: false, message: 'No es tu turno.' });
    }

    if (room.drawnCard) {
      return callback({ success: false, message: 'Ya has robado una carta.' });
    }

    let card;
    if (source === 'deck') {
      if (room.deck.length === 0) {
        if (room.discardPile.length <= 1) {
          if (checkAndHandleGameOver(room, roomId, 'Se agotó el mazo')) {
            return callback({ success: false, message: 'Fin de la partida. Mazo agotado.' });
          }
        }
        const topDiscard = room.discardPile.pop();
        room.deck = room.discardPile.reverse();
        room.discardPile = [topDiscard];
      }
      card = room.deck.pop();
    } else if (source === 'discard') {
      if (room.discardPile.length === 0) {
        return callback({ success: false, message: 'El descarte está vacío.' });
      }
      card = room.discardPile.pop();
    } else {
      return callback({ success: false, message: 'Origen inválido.' });
    }

    room.drawnCard = card;
    room.drawnFrom = source;

    io.to(roomId).emit('cardDrawnEvent', {
      playerSocketId: socket.id,
      source: source,
      cardsInDeck: room.deck.length,
      topDiscard: room.discardPile[room.discardPile.length - 1] || null
    });

    callback({ success: true, card: card });
  });

  // DESCARTAR CARTA ROBADA
  socket.on('discardDrawnCard', ({ roomId }, callback) => {
    const room = roomGames[roomId];
    if (!room || room.state !== 'PLAYING' || socket.id !== room.playerOrder[room.currentTurnIndex]) {
      return callback({ success: false, message: 'No es tu turno.' });
    }

    if (!room.drawnCard || room.drawnFrom === 'discard') {
      return callback({ success: false, message: 'Acción inválida.' });
    }

    const card = room.drawnCard;
    room.discardPile.push(card);
    const cardVal = card.value;

    if ([8, 9, 10, 11].includes(cardVal)) {
      room.state = 'SPECIAL_EFFECT_PHASE';
      room.pendingEffect = cardVal;
      callback({ success: true, triggerEffect: cardVal });
    } else {
      callback({ success: true, triggerEffect: null });
      advanceTurn(room, roomId);
    }
  });

  // REEMPLAZAR CARTA EN TABLERO
  socket.on('replaceBoardCard', ({ roomId, cardIndex }, callback) => {
    const room = roomGames[roomId];
    if (!room || room.state !== 'PLAYING' || socket.id !== room.playerOrder[room.currentTurnIndex]) {
      return callback({ success: false, message: 'No es tu turno.' });
    }

    if (!room.drawnCard) return callback({ success: false, message: 'Debes robar primero.' });

    const player = room.players[socket.id];
    if (cardIndex < 0 || cardIndex >= player.cards.length) {
      return callback({ success: false, message: 'Posición inválida.' });
    }

    const replacedCard = player.cards[cardIndex];
    player.cards[cardIndex] = room.drawnCard;
    room.discardPile.push(replacedCard);

    callback({ success: true, replacedCard: replacedCard });
    advanceTurn(room, roomId);
  });

  // DESCARTE VELOZ FUERA DE TURNO
  socket.on('fastDiscard', ({ roomId, cardIndex }, callback) => {
    const room = roomGames[roomId];
    if (!room || (room.state !== 'PLAYING' && room.state !== 'SPECIAL_EFFECT_PHASE')) {
      return callback({ success: false, message: 'No se puede descartar en este momento.' });
    }

    const player = room.players[socket.id];
    if (!player || cardIndex < 0 || cardIndex >= player.cards.length) {
      return callback({ success: false, message: 'Posición inválida.' });
    }

    const targetCard = player.cards[cardIndex];
    const topDiscard = room.discardPile[room.discardPile.length - 1];

    if (!topDiscard) return callback({ success: false, message: 'El descarte está vacío.' });

    if (targetCard.value === topDiscard.value) {
      player.cards.splice(cardIndex, 1);
      room.discardPile.push(targetCard);

      io.to(roomId).emit('actionAnnouncement', {
        message: `⚡ ¡\({player.name} hizo un descarte veloz con un\){targetCard.value}!`,
        type: 'success'
      });

      broadcastBoardUpdate(room, roomId);
      callback({ success: true, matched: true });

      checkAndHandleGameOver(room, roomId);
    } else {
      let penaltyCard = null;
      if (room.deck.length > 0) {
        penaltyCard = room.deck.pop();
        player.cards.push(penaltyCard);
      }

      io.to(roomId).emit('actionAnnouncement', {
        message: `❌ ¡${player.name} falló el descarte veloz! Recibe 1 carta de penalización.`,
        type: 'danger'
      });

      broadcastBoardUpdate(room, roomId);
      callback({ success: true, matched: false, penaltyCard: penaltyCard });
    }
  });

  // CANTAR FIN DE JUEGO
  socket.on('callEndGame', ({ roomId }, callback) => {
    const room = roomGames[roomId];
    if (!room || room.state !== 'PLAYING' || socket.id !== room.playerOrder[room.currentTurnIndex]) {
      return callback({ success: false, message: 'Solo puedes cantar el fin en tu turno.' });
    }

    const player = room.players[socket.id];
    checkAndHandleGameOver(room, roomId, `¡${player.name} cantó el final de la partida!`);
    callback({ success: true });
  });

  // EFECTOS ESPECIALES
  socket.on('executeEffect8', ({ roomId, cardIndex }, callback) => {
    const room = roomGames[roomId];
    if (!room || room.pendingEffect !== 8 || socket.id !== room.playerOrder[room.currentTurnIndex]) {
      return callback({ success: false, message: 'Acción no permitida.' });
    }
    const player = room.players[socket.id];
    callback({ success: true, card: player.cards[cardIndex] });
    advanceTurn(room, roomId);
  });

  socket.on('executeEffect9', ({ roomId, targetSocketId, cardIndex }, callback) => {
    const room = roomGames[roomId];
    if (!room || room.pendingEffect !== 9 || socket.id !== room.playerOrder[room.currentTurnIndex]) {
      return callback({ success: false, message: 'Acción no permitida.' });
    }
    const targetPlayer = room.players[targetSocketId];
    callback({ success: true, card: targetPlayer.cards[cardIndex] });
    advanceTurn(room, roomId);
  });

  socket.on('executeEffect10', ({ roomId, myCardIndex, targetSocketId, targetCardIndex }, callback) => {
    const room = roomGames[roomId];
    if (!room || room.pendingEffect !== 10 || socket.id !== room.playerOrder[room.currentTurnIndex]) {
      return callback({ success: false, message: 'Acción no permitida.' });
    }

    const me = room.players[socket.id];
    const target = room.players[targetSocketId];

    const temp = me.cards[myCardIndex];
    me.cards[myCardIndex] = target.cards[targetCardIndex];
    target.cards[targetCardIndex] = temp;

    callback({ success: true });
    advanceTurn(room, roomId);
  });

  socket.on('peekForEffect11', ({ roomId, myCardIndex, targetSocketId, targetCardIndex }, callback) => {
    const room = roomGames[roomId];
    if (!room || room.pendingEffect !== 11 || socket.id !== room.playerOrder[room.currentTurnIndex]) {
      return callback({ success: false, message: 'Acción no permitida.' });
    }

    const me = room.players[socket.id];
    const target = room.players[targetSocketId];

    callback({
      success: true,
      myCard: me.cards[myCardIndex],
      targetCard: target.cards[targetCardIndex]
    });
  });

  socket.on('confirmSwapEffect11', ({ roomId, shouldSwap, myCardIndex, targetSocketId, targetCardIndex }, callback) => {
    const room = roomGames[roomId];
    if (!room || room.pendingEffect !== 11 || socket.id !== room.playerOrder[room.currentTurnIndex]) {
      return callback({ success: false, message: 'Acción no permitida.' });
    }

    if (shouldSwap) {
      const me = room.players[socket.id];
      const target = room.players[targetSocketId];
      const temp = me.cards[myCardIndex];
      me.cards[myCardIndex] = target.cards[targetCardIndex];
      target.cards[targetCardIndex] = temp;
    }

    callback({ success: true });
    advanceTurn(room, roomId);
  });

  socket.on('skipEffect', ({ roomId }) => {
    const room = roomGames[roomId];
    if (room && socket.id === room.playerOrder[room.currentTurnIndex]) {
      advanceTurn(room, roomId);
    }
  });

  socket.on('disconnect', () => {
    for (const roomId in roomGames) {
      const room = roomGames[roomId];
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        io.to(roomId).emit('roomUpdated', {
          maxPlayers: room.maxPlayers,
          roomPin: room.roomPin,
          connectedPlayers: Object.values(room.players).map(p => p.name)
        });
        if (Object.keys(room.players).length === 0) {
          delete roomGames[roomId];
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor de juego corriendo en http://localhost:${PORT}`);
});