import React, { useEffect, useRef, useState } from 'react';
import { FaceMesh } from '@mediapipe/face_mesh';
import './styles.css';

const EAR_POINTS = {
  left: { left: 33, top: 159, right: 133, bottom: 145 },
  right: { left: 362, top: 386, right: 263, bottom: 374 },
};

function getEAR(landmarks, { left, top, right, bottom }) {
  const v = Math.hypot(
    landmarks[top].x - landmarks[bottom].x,
    landmarks[top].y - landmarks[bottom].y
  );
  const h = Math.hypot(
    landmarks[left].x - landmarks[right].x,
    landmarks[left].y - landmarks[right].y
  );
  return v / h;
}

function App() {
  const logRef = useRef(null);
  const statusRef = useRef(null);
  const bgVideoRef = useRef(null);
  const voiceAudioRef = useRef(null);
  const inputVideoRef = useRef(null);

  const [audioReady, setAudioReady] = useState(false);
  const [peakOpenness, setPeakOpenness] = useState(0.3);
  const [isRunning, setIsRunning] = useState(false);
  const faceMeshRef = useRef(null);
  const animRef = useRef(null);

  const log = (msg) => {
    console.log(msg);
    if (logRef.current) logRef.current.innerText = msg;
  };

  const setStatus = (msg, color = 'white') => {
    if (statusRef.current) {
      statusRef.current.innerText = msg;
      statusRef.current.style.color = color;
    }
  };

  const onResults = (results) => {
    const statusEl = statusRef.current;
    const voiceAudio = voiceAudioRef.current;
    if (!statusEl || !voiceAudio) return;

    statusEl.innerText = '● ACTIVO';

    if (results.multiFaceLandmarks?.length) {
      const landmarks = results.multiFaceLandmarks[0];
      const leftEAR = getEAR(landmarks, EAR_POINTS.left);
      const rightEAR = getEAR(landmarks, EAR_POINTS.right);
      const currentEAR = (leftEAR + rightEAR) / 2;

      setPeakOpenness((prev) => {
        let next = prev;
        if (currentEAR > prev) next = currentEAR;
        else next = prev * 0.99;
        if (next < 0.2) next = 0.2;
        return next;
      });

      const threshold = (peakOpenness || 0.3) * 0.6;

      if (currentEAR < threshold) {
        statusEl.innerText = '🔊 SONANDO';
        statusEl.style.color = '#0f0';
        if (audioReady && voiceAudio.paused) voiceAudio.play().catch(() => {});
      } else {
        statusEl.innerText = '🔇 SILENCIO';
        statusEl.style.color = 'white';
        if (audioReady && !voiceAudio.paused) voiceAudio.pause();
      }
    } else {
      statusEl.innerText = 'SIN ROSTRO';
      statusEl.style.color = 'red';
      if (audioReady && !voiceAudio.paused) voiceAudio.pause();
    }
  };

  const detectLoop = async () => {
    if (!isRunning) return;
    const faceMesh = faceMeshRef.current;
    const inputVideo = inputVideoRef.current;
    if (faceMesh && inputVideo?.readyState >= 2) {
      try {
        await faceMesh.send({ image: inputVideo });
      } catch (_) {}
    }
    animRef.current = requestAnimationFrame(detectLoop);
  };

  const loadFaceMesh = () => {
    try {
      const faceMesh = new FaceMesh({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      faceMesh.onResults(onResults);
      faceMeshRef.current = faceMesh;
      setIsRunning(true);
      detectLoop();
      log('5. IA Cargando modelo (espera 3-5 seg)...');
    } catch (e) {
      log('ERROR IA: ' + e.message);
    }
  };

  const init = async () => {
    log('1. Iniciando...');
    const startScreen = document.getElementById('start-screen');
    if (startScreen) startScreen.style.display = 'none';

    const voiceAudio = voiceAudioRef.current;
    const bgVideo = bgVideoRef.current;
    const inputVideo = inputVideoRef.current;
    if (!voiceAudio || !bgVideo || !inputVideo) return;

    try {
      await voiceAudio.play().catch(() => {});
      voiceAudio.pause();
      voiceAudio.currentTime = 0;
      setAudioReady(true);
      log('2. Audio desbloqueado.');

      bgVideo.volume = 1.0;
      bgVideo.play().catch((e) => log('Error BG Video: ' + e.message));

      log('3. Solicitando cámara...');
      setStatus('Pidiendo permiso de cámara...', 'yellow');
      const constraints = {
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      };
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia no soportado en este navegador');
      }

      const watchdog = setTimeout(() => {
        log('Permiso de cámara tardando... revisa el prompt del navegador.');
        setStatus('Esperando permiso de cámara...', 'yellow');
      }, 5000);

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        clearTimeout(watchdog);
        inputVideo.srcObject = stream;
        setStatus('Permiso concedido. Preparando video...', '#0f0');
      } catch (camErr) {
        clearTimeout(watchdog);
        // Reintento con constraints sin facingMode por si el dispositivo no soporta 'user'
        log('Fallo al obtener cámara (intentando fallback): ' + camErr.message);
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          inputVideo.srcObject = fallbackStream;
          setStatus('Permiso concedido (fallback). Preparando video...', '#0f0');
        } catch (fallbackErr) {
          throw fallbackErr;
        }
      }

      const loadTimeout = setTimeout(() => {
        log('El video no entregó datos. Revisa que la cámara no esté en uso por otra app.');
        setStatus('Sin datos de cámara.', 'red');
      }, 8000);

      inputVideo.onloadeddata = () => {
        log('4. Cámara lista. Cargando IA...');
        loadFaceMesh();
        clearTimeout(loadTimeout);
      };

      inputVideo.onerror = (e) => {
        log('ERROR de video: ' + (e?.message || 'desconocido'));
      };
    } catch (err) {
      log('ERROR FATAL: ' + err.message + '\nRevisa permisos de cámara y que la conexión sea HTTPS.');
      alert('Error: ' + err.message + '\nRevisa permisos de cámara y que la conexión sea HTTPS.');
    }
  };

  useEffect(() => {
    return () => {
      setIsRunning(false);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      faceMeshRef.current?.close?.();
      const tracks = inputVideoRef.current?.srcObject?.getTracks?.() || [];
      tracks.forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="app">
      <div id="debug-log" ref={logRef} className="debug-log">
        Sistema listo. Esperando usuario...
      </div>

      <div id="status-pill" ref={statusRef} className="status-pill">
        EN ESPERA
      </div>

      <div id="start-screen" className="start-screen">
        <h2>VERSION ESTABLE</h2>
        <p className="hint">Desktop & iOS</p>
        <button className="btn-start" onClick={init}>
          INICIAR
        </button>
      </div>

      <video id="bg-video" ref={bgVideoRef} loop playsInline webkit-playsinline="true" className="bg-video">
        <source src="/supervielle.mp4" type="video/mp4" />
      </video>

      <audio id="voice-audio" ref={voiceAudioRef} preload="auto">
        <source src="/locucion.mp3" type="audio/mpeg" />
      </audio>

      <video
        id="input-video"
        ref={inputVideoRef}
        autoPlay
        muted
        playsInline
        webkit-playsinline="true"
        className="input-video"
      />
    </div>
  );
}

export default App;
