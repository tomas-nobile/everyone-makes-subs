# Cómo ganar la Nerdearla Vibeathon 2026: subtítulos y traducción en vivo multi-escenario con una sola API key de Gemini

La recomendación es un pipeline en cascada. Cada escenario tiene un worker que convierte el audio a PCM de 16 kHz con ffmpeg y lo manda a `gemini-3.5-transcribe-live`, que devuelve texto provisorio y final con vocabulario sesgado. Cada frase final se traduce por texto con Gemini Flash-Lite, usando el glosario de la charla, y el resultado se reparte por SSE a toda la audiencia. Todo eso entra en un contenedor Docker que arranca con `GEMINI_API_KEY` y nada más. `gemini-3.5-live-translate-preview` (voz a voz) queda como un modo premium opcional, con audio traducido para escuchar en el celular. No conviene usarlo como camino principal: cuesta unas 4 veces más por idioma, obliga a abrir una sesión por idioma y por escenario, y no admite glosario ni instrucciones.

## TL;DR

- **Arquitectura ganadora:** ingesta con ffmpeg (archivo, micrófono, RTMP/SRT, YouTube vía yt-dlp) → `gemini-3.5-transcribe-live` (usar el texto provisorio para el original, el final como punto de commit, `custom_vocabulary` con el glosario) → segmentador + traducción por texto con Gemini 3.5 Flash-Lite con glosario y contexto → bus en memoria → SSE hacia miles de espectadores, overlay para OBS y export SRT/VTT. Se transcribe y traduce **una vez por escenario e idioma, nunca por espectador**.
- **Costos 2026 (precios oficiales de Google, pueden cambiar):** según la página oficial de precios de la Gemini API, Transcribe Live cobra US$3,50 por 1M de tokens de entrada y US$21 por 1M de salida, lo que Google resume en una "effective blended rate of ~$0.009 per min" (≈US$0,54/h por escenario). La traducción por texto con Flash-Lite ronda US$0,2–0,3/h por idioma. Da ≈US$0,8–1,1/h por escenario y ≈US$8–11/h para 10 escenarios. Con Live Translate, que la misma página cotiza en "approximately $0.0368 per minute", serían ≈US$2,21/h por escenario e idioma (≈US$22–44/h para 10 escenarios con 1–2 idiomas). El free tier cubre la demo.
- **Lo que define el hackathon:** (1) rotar las sesiones de Transcribe Live antes del tope de 10 minutos sin cortar el subtítulo; (2) cero flicker en la traducción, porque solo se traduce lo confirmado; (3) glosario generado automáticamente del título y abstract de la charla; (4) un video demo con subtítulos en inglés producidos por el propio sistema, con 2 o más escenarios en paralelo visibles en el panel de producción.

## Key Findings

1. **En septiembre de 2026 Google tiene modelos específicos para cada pieza del problema**, y eso cambia el diseño respecto de 2025:
   - `gemini-3.5-transcribe-live`: speech-to-text en streaming sobre la Live API. Entrega `interim_input_transcription` (hipótesis provisoria) e `input_transcription` (final). Detecta el idioma automáticamente, incluido el code-switching. Acepta `custom_vocabulary` de hasta 1.000 frases (mejores resultados con hasta 100), modo `VERBATIM` o `SMART`, y VAD automático, híbrido o manual.
   - `gemini-3.5-live-translate-preview`: traducción voz a voz continua en más de 70 idiomas, con transcripción de entrada y de salida. No admite herramientas, instrucciones de sistema ni entrada de texto.
   - `gemini-3.8-live` (y `gemini-3.1-flash-live-preview`): agentes de voz conversacionales. **No sirven para subtítulos**: trabajan por turnos, responden, y el contexto se re-factura en cada turno.
   - Flash-Lite (3.5 y 3.1) para traducción de texto barata y de baja latencia.
2. **Límites que hay que resolver en el diseño:** según la guía de Live Transcription, las sesiones de transcripción en vivo duran **hasta 10 minutos**. La conexión WebSocket de la Live API en general dura unos 10 minutos. Las sesiones de solo audio se cortan a los 15 minutos sin compresión de contexto, y los tokens de reanudación valen 2 horas. Una charla de 45–60 minutos necesita **5–6 rotaciones de sesión** sí o sí.
3. **La concurrencia de sesiones Live por tier no está publicada** en la documentación del Developer API. Google remite a la página de rate limits de AI Studio de cada proyecto. Hay un reporte de usuario de 2025 en el Google AI Developers Forum, no oficial, de un proyecto en Tier 2 que "should allow up to 1,000 simultaneous Live connections" pero que chocaba con un error "the moment we exceed 50 concurrent connections—exactly the Tier 1 limit". En Vertex/Agent Platform, la documentación de Google Cloud ("Start and manage live sessions") indica: "You can have up to 1,000 concurrent sessions per project on a pay-as-you-go (PayGo) plan." El pipeline recomendado usa **1 sesión Live por escenario**, frente a 1 por escenario **e idioma** con Live Translate.
4. **Las soluciones comerciales líderes también son cascadas.** Wordly hace ASR → traducción automática a nivel de oración o párrafo → TTS, con latencia de subtítulos "sub-three-second", glosarios con reglas *boost/block/replace*, acceso por QR y conexión directa a la consola de sonido. Speechmatics recomienda `max_delay` de 2,0 s para subtitulado y entrega parciales en menos de 500 ms. Deepgram separa `is_final` de `speech_final` y ofrece `utterance_end_ms` para ambientes ruidosos. En open source, Whisper-Streaming (LocalAgreement-2) logra 3,3 s de latencia promedio en ASR de inglés sobre el test set ESIC del Parlamento Europeo con una GPU NVIDIA A40 (Macháček, Dabre y Bojar, 2023). SeamlessStreaming ronda los 2 s a costa de calidad: según la Tabla 28 del paper de Meta, saca 20,0 BLEU X→eng (LAAL 2,20 s) contra 23,7 del SeamlessM4T v2 offline.
5. **Objetivo realista de latencia:** original provisorio en menos de 1 s, original confirmado en 1,5–3 s, traducción confirmada en 2–4 s desde que el orador termina la frase. Eso está en línea con Wordly y Speechmatics. Conviene mostrar la latencia medida en pantalla: es un criterio de evaluación explícito y a este jurado le va a gustar.

## Details

### 1. Cómo están hechas las soluciones existentes

| Solución | Arquitectura (ingesta → ASR → segmentación → MT → entrega) | Qué hace bien | Limitaciones / qué copiar |
|---|---|---|---|
| **Wordly** (comercial) | Audio de la sala o de la consola → ASR en la nube → traducción automática neuronal a nivel de oración o párrafo → subtítulos y audio TTS en el celular del asistente (QR o URL) o en monitores | Latencia "sub-three-second", glosarios ilimitados con *boost/block/replace* editables minutos antes de la sesión, portal del organizador, transcripciones traducidas después del evento | Cerrado y pago. **Copiar:** QR por sala, glosario con reglas de reemplazo, export posterior, pantalla en sala |
| **Speechmatics** (API) | WebSocket en tiempo real con parciales (<500 ms) y finales controlados por `max_delay` (0,7–2 s; recomienda 2,0 s para subtítulos). También ofrece traducción en tiempo real con mensajes `AddPartialTranslation`/`AddTranslation` y `end_of_utterance_silence_trigger` | La perilla explícita de latencia contra precisión | **Copiar:** el modelo parcial/final y la perilla de "delay" configurable |
| **Deepgram** (API) | `interim_results` (`is_final=false/true`) más `endpointing` (por defecto 10 ms de silencio → `speech_final`) más `utterance_end_ms` (≥1000 ms), que funciona aunque haya ruido de fondo | Documenta bien el problema: con música o ruido el VAD no detecta silencio y `speech_final` nunca llega | **Copiar:** un doble disparador de fin de frase (endpoint o timeout) |
| **OpenAI Realtime** | `gpt-realtime-translate` (voz a voz, 70+ idiomas de entrada → 13 de salida, US$0,034/min) y `gpt-realtime-whisper` (STT en streaming, US$0,017/min) | Precio plano por minuto | Solo 13 idiomas de salida y otro vendor (el sponsor es DeepMind) |
| **Google Meet / Translate** | Gemini 3.5 Live Translate integrado en Meet (preview privada para empresas) y en Google Translate | Voz a voz continua, "a pocos segundos del orador" | No es auto-hosteable. Sí es la misma tecnología que podés usar vía API |
| **Whisper-Streaming (UFAL)** | Buffer de audio que crece, re-transcripción con Whisper y **LocalAgreement-2**: se confirma el prefijo que coincide en 2 actualizaciones seguidas, y el buffer avanza al final de una oración confirmada | 3,3 s de latencia promedio en inglés (GPU A40). Probado en una conferencia real | Necesita GPU. UFAL lo considera desactualizado desde 2025 y lo reemplazó por SimulStreaming. **Copiar:** LocalAgreement para estabilizar el texto provisorio |
| **SimulStreaming (UFAL)** | Whisper con la política AlignAtt (o LocalAgreement) y traducción con EuroLLM. Admite **prompts para inyectar terminología** y contexto entre ventanas de 30 s | Estado del arte académico (IWSLT 2025) | Pesado de operar para un hackathon |
| **WhisperLive (Collabora)** | Servidor WebSocket con backends faster-whisper, TensorRT u OpenVINO, VAD por cliente, Docker, extensiones de navegador y overlay de subtítulos | Auto-hosteable, licencia MIT | Hay que proveer GPU para que sea tiempo real. No traduce a español con calidad |
| **stream-translator-gpt** (OSS) | yt-dlp → ffmpeg → VAD → Whisper/faster-whisper → GPT o **Gemini** → stdout | Es exactamente el pipeline de ingesta de streams que necesitás | Una sola sesión, sin UI |
| **SeamlessStreaming (Meta)** | Modelo end-to-end con atención monotónica EMMA, voz a voz y voz a texto | ~2 s de latencia | Pierde calidad frente al modelo offline (20,0 BLEU contra 23,7 X→eng, Tabla 28 del paper de Meta). Verificar licencia antes de usarlo: los modelos Seamless se publicaron con restricciones no comerciales |
| **Gemma 3n / Gemma 4** (local) | ASR y traducción de voz a texto on-device. Gemma 3n procesaba clips de hasta 30 s al lanzarse. Gemma 4 E2B/E4B/12B están entrenados para ASR y AST | 100% local y privado | No es streaming nativo: hay que trocear el audio con VAD (2–8 s), con más latencia |

No investigué a fondo Interprefy, KUDO, Zoom, Otter, Ai-Media/LEXI, Verbit, AssemblyAI ni LiveCaptions para este informe. En términos generales, todos siguen el mismo patrón de parcial/final más glosario, y varios combinan intérpretes humanos con IA. Verificá antes de citarlos en el README. LibreTranslate sirve como traducción automática local de respaldo (verificá su licencia, AGPL, si lo empaquetás).

Otra lección, de Google Research ("Re-translation versus Streaming"): la re-traducción con **masking** (no mostrar las últimas k palabras hasta que el final de la oración de origen esté estable) y **biasing** (sesgar hacia la traducción anterior) casi elimina el flicker sin perder calidad. Mide la inestabilidad como *erasure*: cuántos tokens hay que borrar del sufijo anterior en cada actualización.

**Inteligencia competitiva:** ya hay repos públicos de la Vibeathon 2026. Uno usa FastAPI con una `asyncio.Task` por sesión, Docker Compose, un `FakeSpeechBackend` para funcionar sin key y tracks es/en/pt. Otro usa agentes ADK/A2A que *generan* el MVP. La base (FastAPI, un worker por sesión, Docker) va a ser común. Tus diferenciales tienen que estar en calidad (glosario automático), estabilidad (cero flicker, rotación invisible), métricas de latencia visibles y una operación impecable.

### 2. Gemini en 2026: qué modelo usar para qué

**Formato de audio (común a todos):** PCM crudo de 16 bits little-endian, mono, 16 kHz, MIME `audio/pcm;rate=16000`. La guía de Live Transcription recomienda **chunks de 100 ms** (1.024–2.048 frames). La guía general de buenas prácticas habla de 20–40 ms y de no acumular 1 s antes de enviar. Con 100 ms por chunk son 3.200 bytes. Siempre hay que resamplear de 44,1 o 48 kHz a 16 kHz. La salida de audio (Live Translate) es PCM de 24 kHz.

**Opción A (recomendada): pipeline Transcribe Live → Flash-Lite**
- Setup: `model: models/gemini-3.5-transcribe-live`, `responseModalities: ['TEXT']`, `inputAudioTranscription: { languageCodes: [], customVocabulary: [...], mode: 'VERBATIM' | 'SMART' }`.
- Eventos: el provisorio va a la línea "viva" del original y el final se confirma y se traduce.
- **SMART** quita muletillas, resuelve autocorrecciones y formatea, pero Google aconseja usarlo con VAD manual porque el VAD automático puede partir una idea en una pausa natural. Arrancá con `VERBATIM` y probá `SMART` con tus audios.
- **VAD híbrido:** el VAD del servidor detecta el inicio y el cliente manda `audio_stream_end` cuando detecta silencio, lo que finaliza la frase de inmediato. Sirve para bajar latencia en pausas. Verificá con tu audio que la sesión sigue aceptando audio después de cada `audio_stream_end`.
- La transcripción en vivo **no tiene diarización ni timestamps por palabra**. Los timestamps los calculás vos a partir del reloj de audio enviado.
- Traducción: `gemini-3.5-flash-lite` (US$0,30 de entrada y US$2,50 de salida por 1M de tokens) o `gemini-3.1-flash-lite` (US$0,25 / US$1,50, con apagado anunciado para mayo de 2027). Usá thinking mínimo o bajo, salida estructurada JSON y streaming.

**Opción B: Live Translate end-to-end**
- Setup: `translationConfig: { targetLanguageCode: 'es', echoTargetLanguage: false }` más `inputAudioTranscription` y `outputAudioTranscription`. Te da el original y la traducción, **pero la respuesta es siempre AUDIO**, así que pagás la salida de audio (US$0,0315/min) aunque solo muestres el texto.
- Un solo idioma destino por sesión: 10 escenarios × 2 idiomas = 20 sesiones concurrentes.
- Sin glosario, sin instrucciones y sin contexto de la charla, que es lo que más pesa en el criterio de "términos técnicos".
- Limitaciones documentadas: la detección de idioma sufre con acentos fuertes, con idiomas parecidos (español y portugués) y con cambios rápidos (aunque Google dice que eso afecta sobre todo a la transcripción de entrada). La voz puede cambiar tras pausas largas. No todo el ruido de fondo se filtra.
- **Dónde sí brilla:** como feature "escuchá la traducción en tus auriculares", activable para 1 escenario y 1 idioma. Es un diferencial vistoso.

**Opción C: `gemini-3.8-live` como traductor conversacional.** Descartala para subtítulos: trabaja por turnos, re-factura el contexto acumulado en cada turno y su diseño es de agente.

**Gemma (modo 100% local):** Gemma 3n o Gemma 4 E2B/E4B con prompt de ASR/AST sobre segmentos cortados por VAD (Silero), vía Ollama o transformers. Esperá más latencia (3–8 s) y peor calidad en términos técnicos. En el hackathon alcanza con que sea una **interfaz de backend enchufable** (`SpeechBackend`/`TranslateBackend`) con una implementación de Gemma documentada y marcada como experimental.

**Costos por hora (precios de la página oficial de Gemini al 24/09/2026; los modelos preview pueden cambiar):**

| Escenario | 1 escenario / hora | 10 escenarios / hora | Día Nerdearla (10 esc. × 9 h) |
|---|---|---|---|
| Transcribe Live solo (original) | ≈US$0,54 | ≈US$5,4 | ≈US$49 |
| Pipeline: Transcribe Live + Flash-Lite (1 idioma) | ≈US$0,75–0,85 | ≈US$7,5–8,5 | ≈US$70–75 |
| Pipeline con 2 idiomas destino (en + pt) | ≈US$1,0–1,1 | ≈US$10–11 | ≈US$90–100 |
| Live Translate, 1 idioma | ≈US$2,21 | ≈US$22 | ≈US$200 |
| Live Translate, 2 idiomas | ≈US$4,42 | ≈US$44 | ≈US$400 |
| Referencia: OpenAI gpt-realtime-translate, 1 idioma | ≈US$2,04 | ≈US$20 | ≈US$184 |

Supuestos de la estimación de Flash-Lite: unos 720 llamados por hora (uno cada ~5 s), ~800 tokens de entrada (glosario, contexto de las últimas frases y la frase nueva) y ~30 de salida. Da ≈US$0,2–0,3/h por idioma. **La audiencia no suma costo**: 10 o 10.000 espectadores pagan lo mismo.

**Rate limits y tiers:** los límites son por proyecto, no por API key. Los modelos preview tienen límites más estrictos. Hay límites por gasto en ventanas de 10 minutos (Tier 1: US$10, Tier 2: US$50, Tier 3: US$200) y un 429 `RESOURCE_EXHAUSTED` al superarlos. El pipeline de 10 escenarios gasta ≈US$1,8 cada 10 minutos, bien por debajo del tope de Tier 1. El free tier es gratis para estos modelos, pero **el contenido se usa para mejorar los productos de Google**. Las charlas de Nerdearla son públicas, pero decilo en el README. Para producción, recomendá Tier 1 con billing.

### 3. Entrada de audio: todas las opciones

Normalizá todo a un único contrato interno: **un stream de PCM s16le 16 kHz mono en chunks de 100 ms**. Cada fuente es un "adapter" que lo produce.

| Fuente | Implementación | Notas |
|---|---|---|
| **Archivo (simulación en tiempo real)** | `ffmpeg -re -i charla.mp3 -f s16le -ac 1 -ar 16000 pipe:1` | `-re` lee a velocidad real. Incluí 2 o 3 audios de prueba cortos en `samples/` (uno en español, uno en inglés, uno con code-switching) |
| **YouTube (VOD o Live)** | `yt-dlp -f bestaudio -o - URL \| ffmpeg -re -i pipe:0 -f s16le -ac 1 -ar 16000 pipe:1` (o `yt-dlp -g` para la URL directa, pasada a ffmpeg) | yt-dlp necesita ffmpeg y, para YouTube completo, un runtime JS (deno o node) además de yt-dlp-ejs. Es la fuente de tu video demo |
| **RTMP (desde OBS o vMix)** | `ffmpeg -listen 1 -i rtmp://0.0.0.0:1935/live/stage1 ...` o MediaMTX como servidor RTMP/SRT | OBS puede mandar un segundo output (plugin de múltiples salidas) solo a tu ingesta |
| **SRT** | `ffmpeg -i "srt://0.0.0.0:9001?mode=listener" ...` | Más robusto que RTMP en redes malas. Ideal desde la consola del escenario |
| **HLS** | `ffmpeg -re -i https://.../index.m3u8 ...` | Suma el delay propio de HLS (varios segundos) |
| **Consola o placa de audio** | Linux `-f alsa -i hw:1`, macOS `-f avfoundation -i ":1"`, Windows `-f dshow -i audio="Line In"` | Es la opción de menor latencia en el evento real: un envío auxiliar de la consola a una placa USB |
| **Micrófono del navegador** | `getUserMedia` → `AudioWorklet` → downsample de 48 kHz a 16 kHz → Int16 → WebSocket **a tu servidor** (no a Gemini) | Es la opción de "demo en vivo frente al jurado". Desactivá `echoCancellation`/`noiseSuppression` si la entrada es la línea de la consola |
| **OBS (audio)** | Output RTMP/SRT a tu ingesta, o dispositivo de audio virtual (VB-Cable, BlackHole) → captura de placa | NDI es posible, pero complica licencias y dependencias. Dejalo fuera del hackathon |
| **WebRTC** | LiveKit, Pipecat y Fishjam tienen integraciones oficiales con la Live API | Es excesivo para esto. Mencionalo como camino de escalado |

**Backpressure y reconexión:**
- Una cola acotada por escenario (por ejemplo, 30 s de audio en un ring buffer). Si Gemini se cae, bufferizás, reconectás con backoff exponencial con jitter y reenviás lo pendiente.
- Si el atraso supera un umbral (por ejemplo, 10 s), descartá los chunks de silencio según el VAD para "alcanzar" al orador y marcá el escenario como `DEGRADED` en el panel.
- Si ffmpeg muere (stream caído), reiniciarlo con backoff. Mostrar "sin señal" en la vista de audiencia, no un error.
- Medí `lag = reloj_de_audio_enviado − reloj_real` y la latencia de cada frase: momento en que se mostró el final menos el tiempo de audio del fin de la frase.

### 4. Todas las problemáticas técnicas y cómo resolverlas

**4.1 Segmentación (cuándo "cerrar" una frase y traducirla)**
- Fuente principal: los finales (`input_transcription`) de Transcribe Live, que salen en pausas o fin de turno.
- Problema: un orador que no hace pausas puede demorar el final. Solución de doble disparador, como Deepgram con `speech_final` más `utterance_end`:
  1. Commit por final del modelo.
  2. **Commit forzado** si el provisorio es estable (LocalAgreement-2: el prefijo común de las últimas 2 o 3 actualizaciones), termina en puntuación (`.`, `?`, `!`, `;`) y tiene 6 palabras o más.
  3. Commit forzado por tamaño o tiempo: más de 25 palabras o más de 6 s sin commit. Se corta en la última coma o conjunción del prefijo estable.
- Opcional: VAD local (Silero o por energía) que manda `audio_stream_end` en pausas de 500–700 ms (VAD híbrido) para finalizar antes.
- No hagas wait-k ni re-traducción continua de lo provisorio en el MVP: más costo, más flicker y más complejidad. Traducí **solo lo confirmado**, con las últimas 3–5 frases como contexto, para no perder coherencia.

**4.2 Flicker (subtítulos que saltan)**
- Modelo de dos capas: **líneas confirmadas inmutables** más **una única línea viva** que puede cambiar.
- En el original, la línea viva muestra lo provisorio en gris o itálica. Aplicá *masking*: ocultá las últimas 1 o 2 palabras de lo provisorio salvo que el prefijo esté estable (técnica de Google Translate).
- En la traducción, solo se muestran frases confirmadas: erasure cero por diseño.
- Si el final difiere del commit forzado, no reescribas lo ya mostrado. Como mucho, corregí una vez la última línea con una transición suave. Medí el *erasure* y mostralo en el panel: es una métrica "de paper" que suma puntos.

**4.3 Latencia contra calidad**
- Presupuesto típico: chunk (0,1 s) + ASR provisorio (<1 s) + final (≈0,5–1,5 s después de la pausa) + Flash-Lite (≈0,3–0,8 s hasta el primer token, con streaming) + fan-out SSE (<100 ms). Da **2–4 s para la traducción**.
- Perillas: tamaño mínimo de frase, umbral del commit forzado, nivel de thinking de Flash-Lite (mínimo) y streaming de la traducción token a token solo en la línea viva de destino.
- Mostrá en la UI un indicador de latencia p50/p95 por escenario.

**4.4 Code-switching y detección de idioma**
- `languageCodes: []` activa la detección automática, incluido el code-switching. El original se muestra tal cual se habló.
- Para traducir, en el prompt de Flash-Lite: "traducí al {destino}; si el texto ya está en {destino}, devolvelo igual; mantené en inglés los términos técnicos de la lista *no traducir*". Así se evita "traducir" jerga como deploy, pull request o Kubernetes.
- Si la charla es en español, el track "es" es un alias del original: cero costo.

**4.5 Términos técnicos, nombres propios y siglas**
- **Glosario por charla generado automáticamente** (diferencial): el operador pega el título, el abstract, el nombre del orador y opcionalmente la URL de la agenda o el texto de las slides. Gemini Flash devuelve un JSON con `{asr_vocabulary: [≤100 términos], do_not_translate: [...], preferred_translations: {...}, replacements: {"cubernetes": "Kubernetes"}}`.
- Se usa en tres lugares: `customVocabulary` del ASR (se re-envía en cada rotación de sesión), el prompt de traducción y un post-procesado determinístico de reemplazos (el *replace* de Wordly).
- El título y el abstract también van como contexto en el prompt de traducción, para desambiguar.

**4.6 Ruido, aplausos, música, silencios, preguntas del público y varios oradores**
- Filtrá los segmentos vacíos, solo de puntuación o repetidos de forma idéntica (alucinaciones típicas de ASR sobre música o silencio). Si el modelo emite marcas tipo "[aplausos]", mostralas como un ícono discreto.
- Silencios largos: con el VAD local podés **dejar de enviar audio** (ahorra costo, porque se factura por minuto de audio) manteniendo unos 300 ms de pre-roll para no cortar la primera palabra. Verificá que la sesión no se cierre por inactividad; si pasa, que lo absorba la rotación.
- Preguntas del público: casi siempre llegan con mala señal a la consola. Mostrá "(pregunta del público)" y recomendá en el README un micrófono de sala o de mano conectado a la consola.
- Diarización: no está disponible en vivo. Fuera del MVP.

**4.7 Límite de sesión y charlas de 45–60 minutos**
- Transcribe Live: sesiones de hasta 10 min. Implementá **rotación "make-before-break"**: a los ~9 min (o al recibir `GoAway`, si llega) abrís la sesión B con la misma configuración y glosario, mandás el mismo audio a A y a B durante 2–3 s, y cortás A después de su último final.
- Para deduplicar, descartá de B los finales cuyo tiempo de audio sea anterior al último commit de A.
- Como la transcripción no necesita memoria larga, la rotación es "gratis" en calidad: el contexto semántico lo lleva el traductor, con las últimas frases.
- Documentá que Google no aclara si `sessionResumption` y `contextWindowCompression` aplican a los modelos de transcripción y traducción. Tu diseño no depende de eso.
- Para Live Translate (modo premium) aplica lo mismo: rotación o reanudación con el handle (válido 2 h), escuchando `GoAway`.

**4.8 Rate limits, errores y fallbacks**
- 429 o 503: backoff exponencial con jitter y un máximo de intentos.
- Cadena de fallback para la traducción: 3.5 Flash-Lite → 3.1 Flash-Lite → 3.x Flash.
- Si la traducción falla, **igual se muestra el original**: degradación elegante.
- Opcional: `GEMINI_API_KEY_FALLBACK` de otro proyecto (los límites son por proyecto).
- El panel muestra por escenario: estado, número de sesión, reconexiones, 429 y último error.

**4.9 Escalar a N escenarios**
- Unidad de trabajo: 1 worker por escenario (proceso ffmpeg más sesión Live más traductor). Es trabajo de E/S, no de CPU: un proceso Node o Python maneja 10–20 escenarios sin problema.
- Fan-out: SSE (`text/event-stream`) por `/stages/:id/stream?lang=xx`. Se reconecta solo con `Last-Event-ID`, anda detrás de cualquier proxy y es liviano en el celular. Cada evento pesa unos cientos de bytes.
- Más de una instancia: los workers publican en Redis pub/sub (`stage:{id}:{lang}`) y N réplicas web suscriben y reparten. Poné un CDN o proxy delante.
- Deploy: `docker compose up` con una sola imagen (Node, ffmpeg y yt-dlp) y un volumen para SQLite/JSONL. En Cloud Run, los WebSocket y SSE tienen un **timeout máximo de 60 minutos** y la afinidad de sesión es best-effort. Sirve para la capa web (con reconexión del cliente), pero los workers conviene correrlos en una VM o contenedor siempre encendido (min-instances=1 y CPU siempre asignada si usás Cloud Run).

**4.10 Sincronización con el stream de YouTube**
- En la sala, los subtítulos van 2–4 s *detrás* de la voz, algo aceptable. Quien mira YouTube recibe el video con 5–30 s de delay, así que los subtítulos le llegan *antes*.
- Soluciones:
  1. Overlay quemado en OBS (el audio y el video se sincronizan en el origen): aplicá en OBS un delay de video y audio de ~3 s (filtro de render delay y sync offset) para que el subtítulo quede alineado. Documentá los valores.
  2. En la web, un slider "retraso para stream" (0–30 s) que bufferiza los eventos en el cliente.

**4.11 Accesibilidad y uso en celular**
- Tipografía grande (base 28–48 px, ajustable con A-/A+), alto contraste (blanco sobre negro, modo claro opcional), 2 o 3 líneas visibles, unos 42 caracteres por línea y respeto por `prefers-reduced-motion`.
- Lector de pantalla: `aria-live="polite"` **solo sobre las líneas confirmadas**. Si se anuncia lo provisorio, se vuelve inusable.
- Celular con mala conexión: PWA, payloads chicos, SSE con reanudación, Screen Wake Lock para que no se apague la pantalla, historial local y botón "volver al vivo".

**4.12 Operación en el evento**
- Panel de producción: alta de escenarios, fuente de audio, idiomas, glosario, start/stop/restart, vúmetro de nivel de audio (clave para detectar "no llega señal"), lag, latencia p50/p95, rotaciones, errores y costo estimado acumulado.
- Alertas: sin audio más de 30 s, lag mayor a 10 s o 429 repetidos. Banner rojo y, opcionalmente, webhook.
- Persistencia: cada commit se guarda en JSONL/SQLite con tiempos. Exportación SRT, VTT y TXT por idioma al terminar.

**4.13 Seguridad de la API key**
- Modelo recomendado: **la key vive solo en el servidor**, sea por variable de entorno `GEMINI_API_KEY` o pegada una vez en un wizard de primer arranque y guardada del lado del servidor. La audiencia nunca la toca.
- El panel de admin se protege con un `ADMIN_TOKEN` autogenerado que se imprime en consola al arrancar.
- Modo "todo en el navegador": solo para 1 escenario desde la laptop del operador, con **tokens efímeros** (`uses: 1`, vencen a los 30 min, configuración bloqueada en el servidor). Nunca expongas la key cruda.
- Pros de este modo: cero backend. Contras: no escala, no hay fan-out y depende de la laptop.

### 5. Interfaz propuesta

**(a) Audiencia (`/`, `/s/:stageId`)**
- Home: grilla de escenarios con el estado "EN VIVO", el título de la charla actual y un selector de idioma (Original / Español / English / Português).
- Vista de subtítulos: fondo negro y texto grande. Arriba, las líneas confirmadas con scroll de historial (al scrollear arriba se pausa el autoscroll y aparece el botón "↓ volver al vivo"). Abajo, la línea viva.
- Toggle "mostrar original + traducción" (dos líneas bilingües). A-/A+, contraste y slider de retraso para stream.
- Botón "¿Qué me perdí?" (resumen de los últimos 5 min) y botón "🎧 escuchar traducción" (modo premium con Live Translate).
- **Modo proyector/TV** (`/s/:id/tv?lang=en`): pantalla completa, sin controles, 2 líneas gigantes, pensado para la pantalla lateral de la sala.
- **QR por sala**: el panel genera un QR imprimible por escenario (`/s/:id?lang=es`).

**(b) Producción (`/admin`)**
- Tabla de escenarios: nombre, fuente (archivo, YouTube, RTMP, SRT, placa, micrófono), idiomas, estado (IDLE / CONNECTING / LIVE / DEGRADED / ERROR), vúmetro, lag, latencia p50/p95, sesión #n de rotación, errores y costo/h.
- Botones start/stop/restart y "cargar charla" (título y abstract → genera el glosario → editable).
- Descargas SRT/VTT/TXT. Log en vivo por escenario.

**(c) Overlay para OBS (`/s/:id/overlay?lang=en&lines=2&size=48&bg=transparent`)**
- Browser Source con `background: transparent`, texto con borde o sombra y caja semitransparente opcional. Solo muestra lo confirmado, más la línea viva si `live=1`, parametrizable por query string.
- Referencias de buenas UIs: el overlay de WhisperLive, las pantallas en sala y QR de Wordly, y los live captions de Meet/YouTube (2 líneas abajo, caja negra semitransparente).

### 6. Arquitectura recomendada para el hackathon

**Stack:** Node 22 + TypeScript + Fastify (HTTP, SSE y WS para el micrófono) + `@google/genai` + ffmpeg/yt-dlp como procesos hijos + frontend Vite/React (o HTML y Alpine si querés ir más rápido) + SQLite/JSONL. Se entrega como **una sola imagen Docker**. Python con FastAPI es igual de válido si te sentís más cómodo, pero un solo lenguaje de punta a punta acelera el vibe coding.

```
                    ┌──────────── Contenedor único (docker compose up) ──────────────┐
 Fuentes de audio   │                                                                  │
 ─────────────────  │  StageManager ── crea/destruye 1 StageWorker por escenario       │
 archivo/YouTube ──►│  ┌───────────── StageWorker (escenario N) ─────────────────┐     │
 RTMP/SRT/HLS   ──►│  │ AudioSource (ffmpeg → PCM16 16k mono, chunks 100 ms)    │     │
 placa/consola  ──►│  │   │ ring buffer 30 s + VAD local + vúmetro               │     │
 mic navegador ─WS─►│  │   ▼                                                      │     │
                    │  │ TranscribeSession (gemini-3.5-transcribe-live)          │     │
                    │  │   rotación make-before-break cada ~9 min + dedupe       │─────┼──► Gemini API
                    │  │   interim ──► línea viva (original)                     │     │   (solo el servidor
                    │  │   final ────► Segmenter (final | estable+puntuación |    │     │    tiene la key)
                    │  │                timeout) ──► Commit                       │     │
                    │  │ Translator[es,en,pt] (Flash-Lite + glosario + contexto) │─────┼──► Gemini API
                    │  └──────────────┬──────────────────────────────────────────┘     │
                    │                 ▼                                                  │
                    │  EventBus (EventEmitter; Redis pub/sub si hay >1 réplica)        │
                    │     ├─► Store (SQLite/JSONL) ──► Export SRT/VTT/TXT              │
                    │     ├─► Metrics (lag, p50/p95, erasure, errores, costo)          │
                    │     └─► Fan-out SSE /stages/:id/stream?lang=xx                   │
                    └───────────────┬───────────────┬───────────────┬──────────────────┘
                                    ▼               ▼               ▼
                           Audiencia (celular)  Modo TV/proyector  Overlay OBS (transparente)
                                         Panel /admin (ADMIN_TOKEN)
```

**Contrato de eventos (SSE):** `{type: 'interim'|'commit'|'status', stage, lang, seq, text, tAudioStart, tAudioEnd, latencyMs}`. Tener `seq` monotónico permite reanudar y deduplicar.

**Un solo comando:**
```
docker run -p 8080:8080 -e GEMINI_API_KEY=xxx ghcr.io/vos/nerdcaptions
```
Abre `/admin`, crea automáticamente 2 escenarios demo con los audios de `samples/` y arranca. Esa es tu idea de "solo la API key" hecha realidad. Sumá un `FAKE_BACKEND=1` para que cualquiera pruebe la UI sin key.

**Sección "Cómo escalar" del README (contenido sugerido):**
1. **1 a 10 escenarios:** un solo contenedor (2 vCPU / 2 GB alcanzan, porque es trabajo de E/S). Costo ≈US$1/h por escenario con 2 idiomas.
2. **10 a 30 escenarios:** separar los roles `worker` y `web` con la misma imagen y `ROLE=worker|web`, más Redis pub/sub. Los workers en una VM, la web detrás de un CDN.
3. **Miles de espectadores:** escalar solo las réplicas `web`. El costo de IA no cambia porque se procesa una vez por escenario e idioma.
4. **Cuotas:** Tier 1+ con billing y revisar los límites de concurrencia Live en AI Studio (1 sesión por escenario más la de rotación, es decir, un pico de 2 por escenario). Opcionalmente, key de fallback en otro proyecto.
5. **Local/offline:** `SPEECH_BACKEND=gemma` (experimental).

### 7. Diferenciales priorizados (impacto contra esfuerzo, con ~18 h)

| Prioridad | Idea | Impacto con este jurado | Esfuerzo |
|---|---|---|---|
| ★★★ | **Glosario automático desde el título, el abstract o las slides** → ASR `customVocabulary` y traducción | Calidad en términos técnicos. Uso "inteligente" de Gemini (DevEx de DeepMind) | 1–1,5 h |
| ★★★ | **Métricas de latencia visibles** (p50/p95 por escenario, erasure = 0) | Latencia y operación medibles. Muy "de ingeniería" | 1 h |
| ★★★ | **Video demo subtitulado en inglés por el propio sistema** (export VTT → quemado con ffmpeg) | Los jurados que no hablan español lo entienden. Es el pro-tip de las bases | 1 h |
| ★★★ | **Deploy con un solo comando** más `FAKE_BACKEND` más samples | "Despliegue y operación" | 1 h |
| ★★☆ | Export SRT/VTT/TXT por idioma | Opcional pedido explícitamente | 0,5 h |
| ★★☆ | Overlay OBS transparente parametrizable | Opcional pedido explícitamente. Se ve genial en el video | 0,5–1 h |
| ★★☆ | Portugués (Nerdearla también es Brasil, Chile, Madrid) | Un idioma más cuesta ≈US$0,25/h y un parámetro de config | 0,25 h |
| ★★☆ | "¿Qué me perdí?" (resumen de los últimos N minutos con Flash) | Innovación visible para la audiencia | 1 h |
| ★☆☆ | 🎧 Audio traducido con Live Translate para 1 escenario | Muy vistoso y usa el modelo más nuevo de DeepMind, pero cuesta más | 2–3 h |
| ★☆☆ | Q&A sobre la charla ("preguntale a la charla") | Innovación, aunque se aleja del core | 1,5 h |
| ☆☆☆ | Gemma local funcionando de verdad, detección de slides o código por video, diarización | Alto riesgo para 18 h. Dejalo como interfaz y roadmap | — |

Guiño para Cline (Tomás Barreiro): incluí en el repo un `AGENTS.md` o `.clinerules` y contá en el README cómo se construyó con vibe coding. Es coherente con el espíritu "Vibeathon".

### 8. Plan de ejecución para las ~18 horas (deadline: 25/09/2026 15:00 UTC = 12:00 en Argentina)

**Bloque 0 (0:00–0:30) — Setup.** Repo público, licencia **MIT o Apache 2.0** (archivo `LICENSE`), esqueleto Fastify + Vite, Dockerfile con ffmpeg y yt-dlp, `.env.example`. Bajá con yt-dlp una charla de Nerdearla en español y recortá 2 o 3 samples de 1–2 minutos.

**Bloque 1 (0:30–4:00) — Núcleo, un escenario.**
- AudioSource de archivo con `ffmpeg -re` → TranscribeSession (provisorio y final) → consola.
- Después, el Segmenter y el Translator con Flash-Lite (salida JSON y glosario estático).
- Hito: ves original y traducción en la terminal con la latencia impresa.

**Bloque 2 (4:00–7:00) — Multi-escenario y fan-out.**
- StageManager, EventBus, SSE y la vista de audiencia (selector de escenario e idioma, línea viva y confirmadas).
- Dos escenarios en paralelo con dos samples distintos: **MVP obligatorio cumplido**.
- Commit y push. Dormí si podés.

**Bloque 3 (7:00–10:00) — Robustez.**
- Rotación make-before-break de sesiones (probala forzando la rotación cada 60 s), reconexión con backoff, ring buffer y manejo de 429.
- Fuentes YouTube/HLS y micrófono del navegador (AudioWorklet).
- Hito: una charla de 20 minutos sin cortes.

**Bloque 4 (10:00–13:00) — Diferenciales.**
- Glosario automático desde el abstract, panel `/admin` con métricas, overlay OBS, export SRT/VTT, portugués, modo TV y QR.

**Bloque 5 (13:00–15:30) — Demo y README.**
- Corré una charla real de Nerdearla desde YouTube y exportá el VTT en inglés.
- Grabá 1–2 min en pantalla: el panel con 2 o 3 escenarios en vivo, la audiencia en el celular, el cambio de idioma, el overlay en OBS y las métricas de latencia.
- Quemá los subtítulos en inglés del propio sistema: `ffmpeg -i demo.mp4 -vf subtitles=demo.en.vtt out.mp4`.
- README con: qué es, un GIF, "levantarlo en 1 comando", credenciales (solo `GEMINI_API_KEY`; free tier contra Tier 1 y el tema de uso de datos), fuentes de audio soportadas, arquitectura (el diagrama de arriba), cómo escalar, costos por hora, limitaciones y roadmap (Gemma local, diarización, WebRTC).

**Bloque 6 (15:30–17:00) — Buffer.** Arreglar bugs, probar desde cero en una máquina limpia (`git clone && docker compose up`) y completar Devpost (descripción, video y repo).

**Qué dejar fuera:** wait-k o re-traducción continua, diarización, NDI, Gemma funcional completo, autenticación de usuarios de audiencia, Kubernetes.

**Checklist de entrega:**
- [ ] Repo público con `LICENSE` (MIT o Apache-2.0)
- [ ] README: setup en 1 comando, credenciales/modelos, fuentes de audio, cómo escalar a 10+, costos, limitaciones
- [ ] `samples/` con audios de prueba (es, en, code-switching) y comando de importación (`npm run demo` o el botón en `/admin`)
- [ ] 2 o más sesiones simultáneas demostradas
- [ ] Transcripción en el idioma original y traducción en→es (más es→en para el video)
- [ ] Vistas: audiencia, TV, overlay OBS y panel de producción
- [ ] Export SRT/VTT/TXT
- [ ] Video de 1–2 min con una charla real de Nerdearla y **subtítulos en inglés generados por el sistema**
- [ ] Sin API keys en el repo (revisá el historial de git)

## Recommendations

1. **Andá con el pipeline Transcribe Live → Flash-Lite**, no con Live Translate como base. Ganás en calidad (glosario y contexto), en escalabilidad (1 sesión por escenario), en costo (≈4 veces menos por idioma) y en estabilidad visual. Usá Live Translate solo como feature "🎧" si te sobra tiempo.
2. **Invertí temprano en la rotación de sesiones.** Es el problema técnico que separa una demo de 2 minutos de un sistema para charlas de 60. Probala forzando rotaciones cortas.
3. **Hacé que la experiencia "solo API key" sea literal**: `docker run -e GEMINI_API_KEY=...` levanta 2 escenarios demo andando, más `FAKE_BACKEND` para quien no tenga key.
4. **Vendé con números**: latencia p50/p95, erasure 0 y costo por hora por escenario en el panel y en el README. Es lo que evalúan Calidad, Latencia, Escalabilidad y Operación.
5. **El video lo es todo**: subtítulos en inglés propios, 2 o más escenarios en paralelo, overlay en OBS y un término técnico difícil bien transcripto gracias al glosario automático.

## Caveats

- **Nombres de modelos y precios en preview:** `gemini-3.5-live-translate-preview` y `gemini-3.5-transcribe-live` son recientes (junio y agosto de 2026). Los precios de la familia 3.6–3.8 Flash son introductorios hasta el 31/12/2026 y se duplican desde el 1/1/2027. Verificá los nombres exactos del modelo en AI Studio antes de codear (en Vertex, el de transcripción aparece como `gemini-3.5-transcribe-live-preview`).
- **Concurrencia Live por tier:** no hay un número oficial publicado para el Developer API. El 50/1.000 viene de un reporte de usuario de 2025 en el Google AI Developers Forum. Revisá tu proyecto en AI Studio. Para la demo con 2 o 3 escenarios no debería ser problema.
- **Reanudación y compresión en los modelos de transcripción y traducción:** no están documentadas. Por eso el diseño se apoya en la rotación propia, no en `sessionResumption`.
- **Semántica de `audio_stream_end` en streams continuos:** la documentación lo presenta para VAD híbrido y fin de micrófono. Validá que la sesión siga aceptando audio después.
- **Estimación de costos de Flash-Lite:** depende del tamaño del prompt (glosario y contexto). Las cifras son órdenes de magnitud calculados, no mediciones.
- **Soluciones no investigadas en profundidad** (Interprefy, KUDO, Zoom, Otter, Ai-Media, Verbit, AssemblyAI, LiveCaptions): lo dicho sobre ellas es general. No las cites con cifras sin verificar.
- **Free tier:** Google usa los datos para mejorar sus productos. Aclaralo en el README y recomendá billing (Tier 1) para producción.