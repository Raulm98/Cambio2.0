const socket = io();

let miSalaId = null;
let miRoomPin = '';
let esAdmin = false;
let miSocketId = null;
let gameState = 'LOBBY';
let yaMireCartaInicial = false;
let esMiTurno = false;
let cartaRobada = null;
let origenRobo = null;
let efectoActivo = null;
let modoDescarteVeloz = false;

let seleccionEfecto = { myCardIndex: null, targetSocketId: null, targetCardIndex: null };
let gameOverModalInstance = null;

document.addEventListener('DOMContentLoaded', () => {
  const modalEl = document.getElementById('gameOverModal');
  if (modalEl) {
    gameOverModalInstance = new bootstrap.Modal(modalEl);
  }
});

function mostrarAdmin() {
  document.getElementById('panel-inicio').classList.add('d-none');
  document.getElementById('panel-admin').classList.remove('d-none');
}

function mostrarJugador() {
  document.getElementById('panel-inicio').classList.add('d-none');
  document.getElementById('panel-jugador').classList.remove('d-none');
}

function crearSala() {
  const maxPlayers = document.getElementById('maxPlayers').value;
  const roomPin = document.getElementById('adminPinInput').value.trim();

  if (!roomPin) return alert('Por favor, ingresa un PIN para la sala.');

  socket.emit('createRoom', { maxPlayers, roomPin }, (res) => {
    if (res.success) {
      miSalaId = res.roomId;
      miRoomPin = res.roomPin;
      esAdmin = true;

      alert(`✅ ¡Sala creada con éxito!\n\nID de Sala: ${miSalaId}\nPIN de Acceso: ${miRoomPin}\n\nComparte estos datos con tus jugadores.`);

      document.getElementById('roomIdInput').value = miSalaId;
      document.getElementById('pinInput').value = miRoomPin;
      
      document.getElementById('panel-admin').classList.add('d-none');
      document.getElementById('panel-jugador').classList.remove('d-none');
    } else {
      alert(res.message);
    }
  });
}

function unirseASala() {
  const roomId = document.getElementById('roomIdInput').value.trim().toUpperCase();
  const playerName = document.getElementById('playerNameInput').value.trim();
  const pin = document.getElementById('pinInput').value.trim();

  if (!roomId || !playerName || !pin) return alert('Completa todos los campos.');

  socket.emit('joinRoom', { roomId, playerName, pin }, (res) => {
    if (res.success) {
      miSalaId = res.roomId;
      miSocketId = socket.id;
      document.getElementById('panel-jugador').classList.add('d-none');
      document.getElementById('panel-lobby').classList.remove('d-none');
      document.getElementById('lobbyTitle').innerText = `Sala: ${miSalaId}`;
      document.getElementById('lobbyPinInfo').innerText = `🔑 PIN: ${pin}`;
    } else alert(res.message);
  });
}

function iniciarJuego() {
  socket.emit('startGame', { roomId: miSalaId }, (res) => {
    if (!res.success) alert(res.message);
  });
}

function reiniciarPartida() {
  if (gameOverModalInstance) gameOverModalInstance.hide();
  socket.emit('restartGame', { roomId: miSalaId }, (res) => {
    if (!res.success) alert(res.message);
  });
}

function cantarFinJuego() {
  if (confirm('¿Estás seguro de cantar el final de la partida? Se revelarán los puntos.')) {
    socket.emit('callEndGame', { roomId: miSalaId }, (res) => {
      if (!res.success) alert(res.message);
    });
  }
}

socket.on('roomUpdated', (data) => {
  const list = document.getElementById('playersList');
  list.innerHTML = '';

  data.connectedPlayers.forEach(nombre => {
    const li = document.createElement('li');
    li.className = 'list-group-item bg-dark text-white border-secondary';
    li.innerText = nombre;
    list.appendChild(li);
  });

  if (esAdmin) {
    document.getElementById('adminContainer').classList.remove('d-none');
  }
});

socket.on('gameStarted', (data) => {
  gameState = data.gameState;
  yaMireCartaInicial = false;

  document.getElementById('panel-lobby').classList.add('d-none');
  document.getElementById('panel-juego').classList.remove('d-none');

  document.getElementById('statusBanner').innerText = '👀 Toca 1 de tus cartas para memorizarla (se volteará en 3 seg)';
  document.getElementById('statusBanner').className = 'alert alert-warning fw-bold mb-2 py-2 fs-6';

  document.getElementById('deckCount').innerText = data.cardsInDeck;
  document.getElementById('discardSlot').innerText = formatCardText(data.topDiscard);

  renderizarTableros(data.players);
});

function renderizarTableros(players) {
  const opponentsArea = document.getElementById('opponentsArea');
  opponentsArea.innerHTML = '';

  players.forEach(p => {
    if (p.socketId !== socket.id) {
      const oppDiv = document.createElement('div');
      oppDiv.className = 'text-center p-1 border border-secondary rounded';
      
      let cardsHtml = p.cards.map((_, index) => 
        `<div id="opp-${p.socketId}-card-${index}" class="card-slot card-back" style="width:30px; height:45px; font-size:0.6rem;" onclick="tocarCartaOponente('${p.socketId}', ${index})">🎴</div>`
      ).join('');

      oppDiv.innerHTML = `<small class="fw-bold d-block mb-1">${p.name}</small><div class="d-flex flex-wrap justify-content-center">${cardsHtml}</div>`;
      opponentsArea.appendChild(oppDiv);
    } else {
      const myCardsGrid = document.getElementById('myCardsGrid');
      myCardsGrid.innerHTML = '';

      p.cards.forEach((_, index) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card-slot card-back';
        cardDiv.id = `my-card-${index}`;
        cardDiv.innerText = '🎴';
        cardDiv.onclick = () => tocarCartaPropia(index);
        myCardsGrid.appendChild(cardDiv);
      });
    }
  });
}

function toggleModoDescarteVeloz() {
  modoDescarteVeloz = !modoDescarteVeloz;
  const btn = document.getElementById('btnToggleFastDiscard');
  const grid = document.getElementById('myCardsGrid');

  if (modoDescarteVeloz) {
    btn.className = 'btn btn-warning btn-sm fw-bold';
    btn.innerText = '⚡ Toca tu carta para Descarte Veloz';
    Array.from(grid.children).forEach(child => child.classList.add('slot-fast-discard'));
  } else {
    btn.className = 'btn btn-danger btn-sm fw-bold';
    btn.innerText = '⚡ Descarte Veloz';
    Array.from(grid.children).forEach(child => child.classList.remove('slot-fast-discard'));
  }
}

function tocarCartaPropia(index) {
  if (modoDescarteVeloz) {
    socket.emit('fastDiscard', { roomId: miSalaId, cardIndex: index }, (res) => {
      toggleModoDescarteVeloz();
      if (!res.success) alert(res.message);
    });
    return;
  }

  if (gameState === 'PEEK_PHASE') {
    if (yaMireCartaInicial) return alert('Ya miraste tu carta inicial.');

    socket.emit('peekInitialCard', { roomId: miSalaId, cardIndex: index }, (res) => {
      if (res.success) {
        yaMireCartaInicial = true;
        voltearCartaTemporal(`my-card-${index}`, res.card, 3000);
      } else alert(res.message);
    });
  } 
  else if (gameState === 'PLAYING' && esMiTurno && cartaRobada) {
    socket.emit('replaceBoardCard', { roomId: miSalaId, cardIndex: index }, (res) => {
      if (res.success) ocultarSeccionRobo();
      else alert(res.message);
    });
  }
  else if (gameState === 'SPECIAL_EFFECT_PHASE' && esMiTurno) {
    if (efectoActivo === 8) {
      socket.emit('executeEffect8', { roomId: miSalaId, cardIndex: index }, (res) => {
        if (res.success) {
          voltearCartaTemporal(`my-card-${index}`, res.card, 3000);
          limpiarEfecto();
        } else alert(res.message);
      });
    } else if (efectoActivo === 10 || efectoActivo === 11) {
      seleccionEfecto.myCardIndex = index;
      marcarCartaSeleccionada(`my-card-${index}`);
      verificarYEjecutarEfectosComplejos();
    }
  }
}

function tocarCartaOponente(targetSocketId, index) {
  if (gameState === 'SPECIAL_EFFECT_PHASE' && esMiTurno) {
    if (efectoActivo === 9) {
      socket.emit('executeEffect9', { roomId: miSalaId, targetSocketId, cardIndex: index }, (res) => {
        if (res.success) {
          voltearCartaTemporal(`opp-${targetSocketId}-card-${index}`, res.card, 3000);
          limpiarEfecto();
        } else alert(res.message);
      });
    } else if (efectoActivo === 10 || efectoActivo === 11) {
      seleccionEfecto.targetSocketId = targetSocketId;
      seleccionEfecto.targetCardIndex = index;
      marcarCartaSeleccionada(`opp-${targetSocketId}-card-${index}`);
      verificarYEjecutarEfectosComplejos();
    }
  }
}

function verificarYEjecutarEfectosComplejos() {
  if (seleccionEfecto.myCardIndex !== null && seleccionEfecto.targetSocketId !== null) {
    if (efectoActivo === 10) {
      socket.emit('executeEffect10', {
        roomId: miSalaId,
        myCardIndex: seleccionEfecto.myCardIndex,
        targetSocketId: seleccionEfecto.targetSocketId,
        targetCardIndex: seleccionEfecto.targetCardIndex
      }, (res) => {
        if (res.success) {
          alert('🔄 Cartas intercambiadas exitosamente a ciegas.');
          limpiarEfecto();
        } else alert(res.message);
      });
    } else if (efectoActivo === 11) {
      socket.emit('peekForEffect11', {
        roomId: miSalaId,
        myCardIndex: seleccionEfecto.myCardIndex,
        targetSocketId: seleccionEfecto.targetSocketId,
        targetCardIndex: seleccionEfecto.targetCardIndex
      }, (res) => {
        if (res.success) {
          document.getElementById('effect11Panel').classList.remove('d-none');
          document.getElementById('effect11MyCard').innerText = formatCardText(res.myCard);
          document.getElementById('effect11TargetCard').innerText = formatCardText(res.targetCard);
        } else alert(res.message);
      });
    }
  }
}

function decidirIntercambio11(shouldSwap) {
  socket.emit('confirmSwapEffect11', {
    roomId: miSalaId,
    shouldSwap,
    myCardIndex: seleccionEfecto.myCardIndex,
    targetSocketId: seleccionEfecto.targetSocketId,
    targetCardIndex: seleccionEfecto.targetCardIndex
  }, (res) => {
    if (res.success) {
      document.getElementById('effect11Panel').classList.add('d-none');
      limpiarEfecto();
    } else alert(res.message);
  });
}

function omitirEfecto() {
  socket.emit('skipEffect', { roomId: miSalaId });
  limpiarEfecto();
}

function limpiarEfecto() {
  efectoActivo = null;
  seleccionEfecto = { myCardIndex: null, targetSocketId: null, targetCardIndex: null };
  document.getElementById('btnSkipEffect').classList.add('d-none');
  document.querySelectorAll('.slot-selectable, .slot-selected').forEach(el => {
    el.classList.remove('slot-selectable', 'slot-selected');
  });
}

socket.on('startTurnPhase', (data) => {
  gameState = 'PLAYING';
  actualizarTurnoUI(data.currentTurnSocketId);
});

function robarMazo() {
  if (gameState !== 'PLAYING' || !esMiTurno || cartaRobada) return;

  socket.emit('drawCard', { roomId: miSalaId, source: 'deck' }, (res) => {
    if (res.success) {
      cartaRobada = res.card;
      origenRobo = 'deck';
      mostrarSeccionRobo(res.card, true);
    } else alert(res.message);
  });
}

function robarDescarte() {
  if (gameState !== 'PLAYING' || !esMiTurno || cartaRobada) return;

  socket.emit('drawCard', { roomId: miSalaId, source: 'discard' }, (res) => {
    if (res.success) {
      cartaRobada = res.card;
      origenRobo = 'discard';
      mostrarSeccionRobo(res.card, false);
    } else alert(res.message);
  });
}

function mostrarSeccionRobo(card, permiteDescarte) {
  const drawnSection = document.getElementById('drawnCardSection');
  const drawnDisplay = document.getElementById('drawnCardDisplay');
  const btnDiscard = document.getElementById('btnDiscardDrawn');

  drawnSection.classList.remove('d-none');
  drawnDisplay.innerText = formatCardText(card);

  if (permiteDescarte) {
    btnDiscard.classList.remove('d-none');
    document.getElementById('statusBanner').innerText = '👉 Selecciona una carta de tu tablero para reemplazarla O usa "Descartar".';
  } else {
    btnDiscard.classList.add('d-none');
    document.getElementById('statusBanner').innerText = '👉 Debes reemplazar una carta de tu tablero por la carta robada.';
  }

  const grid = document.getElementById('myCardsGrid');
  Array.from(grid.children).forEach(child => child.classList.add('slot-selectable'));
}

function descartarCartaRobada() {
  if (!cartaRobada) return;

  socket.emit('discardDrawnCard', { roomId: miSalaId }, (res) => {
    if (res.success) {
      ocultarSeccionRobo();
      if (res.triggerEffect) {
        activarModoEfecto(res.triggerEffect);
      }
    } else alert(res.message);
  });
}

function activarModoEfecto(efecto) {
  gameState = 'SPECIAL_EFFECT_PHASE';
  efectoActivo = efecto;
  document.getElementById('btnSkipEffect').classList.remove('d-none');

  const banner = document.getElementById('statusBanner');
  banner.className = 'alert alert-warning fw-bold mb-2 py-2 fs-6';

  if (efecto === 8) banner.innerText = '✨ Efecto 8: Toca una de TUS cartas para verla.';
  else if (efecto === 9) banner.innerText = '✨ Efecto 9: Toca la carta de un OPONENTE para verla.';
  else if (efecto === 10) banner.innerText = '✨ Efecto 10: Toca 1 carta tuya y 1 de un oponente para INTERCAMBIAR A CIEGAS.';
  else if (efecto === 11) banner.innerText = '✨ Efecto 11 (Sota): Toca 1 carta tuya y 1 de un oponente para ver ambas y decidir.';
}

function ocultarSeccionRobo() {
  cartaRobada = null;
  origenRobo = null;
  document.getElementById('drawnCardSection').classList.add('d-none');
  document.querySelectorAll('.slot-selectable').forEach(el => el.classList.remove('slot-selectable'));
}

socket.on('actionAnnouncement', (data) => {
  const banner = document.getElementById('statusBanner');
  banner.innerText = data.message;
  banner.className = `alert alert-${data.type} fw-bold mb-2 py-2 fs-6`;
});

socket.on('boardStateUpdated', (data) => {
  document.getElementById('deckCount').innerText = data.cardsInDeck;
  if (data.topDiscard) {
    document.getElementById('discardSlot').innerText = formatCardText(data.topDiscard);
  }
  renderizarTableros(data.players);
});

socket.on('cardDrawnEvent', (data) => {
  document.getElementById('deckCount').innerText = data.cardsInDeck;
  if (data.topDiscard) {
    document.getElementById('discardSlot').innerText = formatCardText(data.topDiscard);
  }
});

socket.on('turnUpdated', (data) => {
  if (data.topDiscard) {
    document.getElementById('discardSlot').innerText = formatCardText(data.topDiscard);
  }
  document.getElementById('deckCount').innerText = data.cardsInDeck;
  actualizarTurnoUI(data.currentTurnSocketId);
});

function actualizarTurnoUI(turnSocketId) {
  esMiTurno = turnSocketId === socket.id;

  const btnCallEnd = document.getElementById('btnCallEnd');

  if (esMiTurno) {
    document.getElementById('statusBanner').innerText = '🟢 ¡Es tu turno! Toca el Mazo o el Pozo de descarte.';
    document.getElementById('statusBanner').className = 'alert alert-success fw-bold mb-2 py-2 fs-6';
    btnCallEnd.classList.remove('d-none');
  } else {
    document.getElementById('statusBanner').innerText = '⏳ Turno del oponente...';
    document.getElementById('statusBanner').className = 'alert alert-secondary fw-bold mb-2 py-2 fs-6';
    btnCallEnd.classList.add('d-none');
  }
}

socket.on('gameOverEvent', (data) => {
  gameState = 'GAME_OVER';

  document.getElementById('gameOverReason').innerText = data.reason;
  const podiumList = document.getElementById('podiumList');
  podiumList.innerHTML = '';

  const rankIcons = ['🥇', '🥈', '🥉'];

  data.scoreboard.forEach((p, idx) => {
    const rankIcon = rankIcons[idx] || `#${idx + 1}`;
    const rankClass = idx < 3 ? `rank-${idx + 1}` : '';

    const cardsText = p.cards.map(c => formatCardText(c)).join(', ') || '<em>Sin cartas</em>';

    const item = document.createElement('div');
    item.className = 'list-group-item bg-dark border-secondary text-start text-white my-1 rounded';
    item.innerHTML = `
      <div class="d-flex justify-content-between align-items-center">
        <span class="podium-rank ${rankClass}">${rankIcon} ${p.name}</span>
        <span class="badge bg-warning text-dark fs-6">${p.score} Pts</span>
      </div>
      <small class="text-white-50 d-block mt-1">Cartas: ${cardsText}</small>
    `;
    podiumList.appendChild(item);
  });

  if (esAdmin) {
    document.getElementById('btnRestartGame').classList.remove('d-none');
  } else {
    document.getElementById('btnRestartGame').classList.add('d-none');
  }

  if (gameOverModalInstance) {
    gameOverModalInstance.show();
  }
});

function voltearCartaTemporal(elementId, card, durationMs) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const originalClass = el.className;
  const originalText = el.innerText;

  el.className = 'card-slot card-front peek-active';
  el.innerText = formatCardText(card);

  setTimeout(() => {
    el.className = originalClass;
    el.innerText = originalText;
  }, durationMs);
}

function marcarCartaSeleccionada(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.classList.add('slot-selected');
}

function formatCardText(card) {
  if (!card) return '--';
  if (card.suit === 'joker') return '🃏 JOKER';
  const icons = { espadas: '⚔️', copas: '🏆', oros: '🪙', bastos: '🪵' };
  return `${card.value} ${icons[card.suit] || ''}`;
}