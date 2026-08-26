import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, update, onValue } from 'firebase/database';

// -------------------------------------------------------------
// 🔴 REMPLACE CE BLOC PAR TES IDENTIFIANTS FIREBASE :
// -------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyBJEqm__ZV5zt-mk2ncFbuwqPpCviNGgRA",
  authDomain: "uno-party-35601.firebaseapp.com",
  databaseURL: "https://uno-party-35601-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "uno-party-35601",
  storageBucket: "uno-party-35601.firebasestorage.app",
  messagingSenderId: "1012563524351",
  appId: "1:1012563524351:web:2ef22a05f8791d4af8eaca",
  measurementId: "G-J0QF6YM4XQ"
};

// Initialisation de Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const COLORS = ['red', 'blue', 'green', 'yellow'];

// Création d'un paquet de cartes Uno complet
function buildDeck() {
  const deck = [];
  let id = 0;
  COLORS.forEach(color => {
    deck.push({ id: `c_${id++}`, color, value: '0' });
    for (let i = 0; i < 2; i++) {
      ['1','2','3','4','5','6','7','8','9','skip','reverse','+2'].forEach(val => {
        deck.push({ id: `c_${id++}`, color, value: val });
      });
    }
  });
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `c_${id++}`, color: 'wild', value: 'wild' });
    deck.push({ id: `c_${id++}`, color: 'wild', value: '+4' });
  }
  return deck.sort(() => Math.random() - 0.5);
}

export default function App() {
  const [userId] = useState(() => 'u_' + Math.random().toString(36).substring(2, 8));
  const [userName, setUserName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [joined, setJoined] = useState(false);
  const [roomState, setRoomState] = useState(null);
  const [selectedWildCard, setSelectedWildCard] = useState(null);

  // Écoute en temps réel de la partie
  useEffect(() => {
    if (!joined || !roomCode) return;
    const roomRef = ref(db, `rooms/${roomCode}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      setRoomState(snapshot.val());
    });
    return () => unsubscribe();
  }, [joined, roomCode]);

  // Rejoindre ou créer un salon
  const joinRoom = async (code) => {
    if (!userName.trim()) {
      alert("Merci d'entrer ton prénom !");
      return;
    }
    const cleanCode = code.toUpperCase().trim();
    const playerRef = ref(db, `rooms/${cleanCode}/players/${userId}`);
    await set(playerRef, { name: userName.trim(), hand: [], order: 0 });
    
    // Si la salle n'a pas encore de statut, on la met en lobby
    const statusRef = ref(db, `rooms/${cleanCode}/status`);
    onValue(statusRef, (snap) => {
      if (!snap.exists()) {
        set(statusRef, 'lobby');
      }
    }, { onlyOnce: true });

    setRoomCode(cleanCode);
    setJoined(true);
  };

  // Lancer la partie
  const startGame = async () => {
    const fullDeck = buildDeck();
    const playersList = Object.keys(roomState.players || {});
    const updates = {};

    playersList.forEach((pId, idx) => {
      updates[`rooms/${roomCode}/players/${pId}/hand`] = fullDeck.splice(0, 7);
      updates[`rooms/${roomCode}/players/${pId}/order`] = idx;
    });

    let top = fullDeck.pop();
    while (top.color === 'wild') {
      fullDeck.unshift(top);
      top = fullDeck.pop();
    }

    updates[`rooms/${roomCode}/deck`] = fullDeck;
    updates[`rooms/${roomCode}/topCard`] = top;
    updates[`rooms/${roomCode}/activeColor`] = top.color;
    updates[`rooms/${roomCode}/currentPlayerIndex`] = 0;
    updates[`rooms/${roomCode}/direction`] = 1;
    updates[`rooms/${roomCode}/status`] = 'playing';

    await update(ref(db), updates);
  };

  // Qui doit jouer ?
  const getPlayerTurn = () => {
    if (!roomState || !roomState.players) return null;
    const sorted = Object.keys(roomState.players).sort(
      (a, b) => roomState.players[a].order - roomState.players[b].order
    );
    return sorted[roomState.currentPlayerIndex];
  };

  // Poser une carte
  const playCard = async (card, chosenColor = null) => {
    const isCurrentTurn = getPlayerTurn() === userId;
    if (!isCurrentTurn) return;

    const isValid = card.color === 'wild' || 
                    card.color === roomState.activeColor || 
                    card.value === roomState.topCard.value;

    if (!isValid) return;

    if (card.color === 'wild' && !chosenColor) {
      setSelectedWildCard(card);
      return;
    }

    const myHand = roomState.players[userId].hand.filter(c => c.id !== card.id);
    const updates = {};
    updates[`rooms/${roomCode}/players/${userId}/hand`] = myHand;
    updates[`rooms/${roomCode}/topCard`] = card;
    updates[`rooms/${roomCode}/activeColor`] = chosenColor || card.color;

    // Calcul du tour suivant
    const playerIds = Object.keys(roomState.players).sort(
      (a, b) => roomState.players[a].order - roomState.players[b].order
    );
    const totalPlayers = playerIds.length;
    let nextIndex = (roomState.currentPlayerIndex + roomState.direction + totalPlayers) % totalPlayers;

    // Effets des cartes spéciales
    if (card.value === 'skip') {
      nextIndex = (nextIndex + roomState.direction + totalPlayers) % totalPlayers;
    } else if (card.value === 'reverse') {
      const newDir = roomState.direction * -1;
      updates[`rooms/${roomCode}/direction`] = newDir;
      nextIndex = (roomState.currentPlayerIndex + newDir + totalPlayers) % totalPlayers;
    } else if (card.value === '+2' || card.value === '+4') {
      const drawCount = card.value === '+2' ? 2 : 4;
      const targetId = playerIds[nextIndex];
      const deck = [...(roomState.deck || [])];
      const drawn = deck.splice(0, drawCount);
      const targetHand = [...(roomState.players[targetId].hand || []), ...drawn];
      
      updates[`rooms/${roomCode}/deck`] = deck;
      updates[`rooms/${roomCode}/players/${targetId}/hand`] = targetHand;
      nextIndex = (nextIndex + roomState.direction + totalPlayers) % totalPlayers;
    }

    // Victoire ?
    if (myHand.length === 0) {
      updates[`rooms/${roomCode}/status`] = 'finished';
      updates[`rooms/${roomCode}/winner`] = roomState.players[userId].name;
    }

    updates[`rooms/${roomCode}/currentPlayerIndex`] = nextIndex;
    setSelectedWildCard(null);
    await update(ref(db), updates);
  };

  // Piocher une carte
  const drawCard = async () => {
    if (getPlayerTurn() !== userId) return;
    const deck = [...(roomState.deck || [])];
    if (deck.length === 0) return;

    const drawn = deck.pop();
    const myHand = [...(roomState.players[userId].hand || []), drawn];
    
    const playerIds = Object.keys(roomState.players).sort(
      (a, b) => roomState.players[a].order - roomState.players[b].order
    );
    const nextIndex = (roomState.currentPlayerIndex + roomState.direction + playerIds.length) % playerIds.length;

    const updates = {};
    updates[`rooms/${roomCode}/deck`] = deck;
    updates[`rooms/${roomCode}/players/${userId}/hand`] = myHand;
    updates[`rooms/${roomCode}/currentPlayerIndex`] = nextIndex;

    await update(ref(db), updates);
  };

  // Écran d'accueil (Rejoindre / Créer)
  if (!joined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md space-y-6">
          <h1 className="text-3xl font-extrabold text-center text-red-600 tracking-wider">🎴 UNO EN LIGNE</h1>
          
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Ton prénom :</label>
            <input 
              placeholder="Ex: Alex" 
              value={userName} 
              onChange={e => setUserName(e.target.value)}
              className="w-full border-2 border-gray-300 p-3 rounded-lg focus:outline-none focus:border-red-500 font-medium"
            />
          </div>

          <button 
            onClick={() => joinRoom(Math.random().toString(36).substring(2, 6))}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-lg shadow-md transition"
          >
            Créer un nouveau salon
          </button>

          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-gray-300"></div>
            <span className="flex-shrink mx-4 text-gray-400 font-semibold text-sm">OU REJOINDRE</span>
            <div className="flex-grow border-t border-gray-300"></div>
          </div>

          <div className="flex gap-2">
            <input 
              placeholder="Code (ex: 4A2F)" 
              value={roomCode} 
              onChange={e => setRoomCode(e.target.value.toUpperCase())}
              className="border-2 border-gray-300 p-3 rounded-lg flex-1 text-center font-bold tracking-widest uppercase focus:outline-none focus:border-red-500"
            />
            <button 
              onClick={() => joinRoom(roomCode)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-lg shadow-md transition"
            >
              Entrer
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Écran de jeu
  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 flex flex-col justify-between">
      {/* Barre supérieure */}
      <div className="flex justify-between items-center bg-slate-800 p-4 rounded-xl border border-slate-700">
        <div>
          <span className="text-gray-400 text-sm">Salon : </span>
          <span className="font-extrabold text-xl text-yellow-400 tracking-wider">{roomCode}</span>
        </div>
        <div>
          <span className="text-sm bg-slate-700 px-3 py-1 rounded-full font-semibold">
            👥 {Object.keys(roomState?.players || {}).length} joueur(s)
          </span>
        </div>
      </div>

      {/* Salon d'attente (Lobby) */}
      {roomState?.status === 'lobby' && (
        <div className="text-center my-auto space-y-6 bg-slate-800 p-8 rounded-2xl border border-slate-700 max-w-md mx-auto w-full">
          <h2 className="text-2xl font-bold">En attente des amis...</h2>
          <p className="text-gray-400 text-sm">Donne ce code à tes potes : <span className="font-bold text-white text-lg">{roomCode}</span></p>
          <div className="space-y-2">
            {Object.values(roomState.players || {}).map((p, idx) => (
              <div key={idx} className="bg-slate-700 p-2 rounded font-semibold">
                👤 {p.name} {p.name === userName && "(Toi)"}
              </div>
            ))}
          </div>
          <button 
            onClick={startGame} 
            className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-xl shadow-lg transition"
          >
            Démarrer la partie 🚀
          </button>
        </div>
      )}

      {/* Victoire */}
      {roomState?.status === 'finished' && (
        <div className="text-center my-auto space-y-4 bg-slate-800 p-8 rounded-2xl border border-slate-700 max-w-md mx-auto">
          <h2 className="text-3xl font-extrabold text-yellow-400">🏆 Victoire !</h2>
          <p className="text-xl">{roomState.winner} a gagné la partie !</p>
          <button onClick={startGame} className="bg-red-600 text-white font-bold px-6 py-3 rounded-xl mt-4">
            Rejouer une manche
          </button>
        </div>
      )}

      {/* Plateau de jeu en cours */}
      {roomState?.status === 'playing' && (
        <div className="flex-1 flex flex-col justify-around py-4">
          
          {/* Centre de table */}
          <div className="flex justify-center items-center gap-6">
            {/* Pioche */}
            <button 
              onClick={drawCard}
              disabled={getPlayerTurn() !== userId}
              className={`w-24 h-36 rounded-xl border-4 border-slate-600 bg-slate-800 flex flex-col justify-center items-center font-bold text-white shadow-2xl transition ${
                getPlayerTurn() === userId ? 'hover:scale-105 border-yellow-400 cursor-pointer' : 'opacity-50'
              }`}
            >
              <span className="text-xs text-gray-400">PIOCHE</span>
              <span className="text-3xl mt-1">📥</span>
            </button>

            {/* Talon (Carte du dessus) */}
            <div className={`w-28 h-40 rounded-xl border-4 flex flex-col justify-between p-2 font-black text-white shadow-2xl ${
              roomState.activeColor === 'red' ? 'bg-red-600 border-red-400' :
              roomState.activeColor === 'blue' ? 'bg-blue-600 border-blue-400' :
              roomState.activeColor === 'green' ? 'bg-green-600 border-green-400' :
              'bg-yellow-500 border-yellow-300 text-slate-900'
            }`}>
              <span className="text-xs uppercase">{roomState.activeColor}</span>
              <span className="text-4xl text-center font-black">{roomState.topCard?.value}</span>
              <span className="text-xs text-right uppercase">{roomState.activeColor}</span>
            </div>
          </div>

          {/* Zone du joueur */}
          <div className="space-y-3">
            <div className="text-center font-bold">
              {getPlayerTurn() === userId ? (
                <span className="bg-yellow-400 text-slate-900 px-4 py-1.5 rounded-full animate-pulse">
                  👉 C'EST À TOI DE JOUER !
                </span>
              ) : (
                <span className="text-gray-400 text-sm">
                  Tour de : <span className="text-white font-semibold">{roomState.players[getPlayerTurn()]?.name}</span>
                </span>
              )}
            </div>

            {/* Main de cartes */}
            <div className="flex flex-wrap justify-center gap-2 max-h-48 overflow-y-auto p-2">
              {roomState.players[userId]?.hand?.map(card => (
                <button
                  key={card.id}
                  onClick={() => playCard(card)}
                  className={`w-16 h-24 rounded-lg border-2 flex flex-col justify-between p-1.5 font-bold shadow-lg transition transform hover:-translate-y-2 ${
                    card.color === 'red' ? 'bg-red-600 border-red-400 text-white' :
                    card.color === 'blue' ? 'bg-blue-600 border-blue-400 text-white' :
                    card.color === 'green' ? 'bg-green-600 border-green-400 text-white' :
                    card.color === 'yellow' ? 'bg-yellow-500 border-yellow-300 text-slate-900' :
                    'bg-slate-900 border-purple-500 text-white'
                  }`}
                >
                  <span className="text-xs">{card.value}</span>
                  <span className="text-center text-lg">{card.value}</span>
                  <span className="text-xs text-right">{card.value}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Modale choix de couleur Joker */}
          {selectedWildCard && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
              <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl space-y-4 text-center max-w-xs w-full shadow-2xl">
                <h4 className="font-bold text-lg">Choisis la couleur :</h4>
                <div className="grid grid-cols-2 gap-3">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => playCard(selectedWildCard, c)}
                      className={`p-4 rounded-xl font-extrabold capitalize text-white shadow transition ${
                        c === 'red' ? 'bg-red-600 hover:bg-red-500' :
                        c === 'blue' ? 'bg-blue-600 hover:bg-blue-500' :
                        c === 'green' ? 'bg-green-600 hover:bg-green-500' : 
                        'bg-yellow-500 hover:bg-yellow-400 text-slate-900'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
