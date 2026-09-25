# Devpost: About the project (Spanish, paste-ready)

## Inspiración

En una conferencia como Nerdearla hay charlas en paralelo en español y en inglés, y una parte del público no puede seguir uno de los dos idiomas.

Quería lo contrario: que **cualquier persona del equipo de producción** pudiera dar subtítulos en vivo y traducidos a **todas** las salas del evento, y que el costo no dependiera de cuánta gente los lee.

## Qué hace

Cada sala del evento tiene subtítulos en vivo y traducción, y cada asistente los lee en su propio celular, en su idioma:

- **El público** escanea el QR de la sala. El teléfono elige su idioma, muestra lo que dice el orador en letras grandes (original o traducido a es/en/pt), un indicador de "hablando…", el historial, un resumen de "¿qué me perdí?" y, al terminar la charla, la descarga de los subtítulos.
- **El operador** (alguien de producción, no un desarrollador) instala **una app**, pega una clave de Gemini, pega la agenda tal como está en la web del evento y conecta cada sala.
- **El técnico de sala** abre un link en la laptop conectada a la consola y elige la entrada.
- **Las pantallas de sala** tienen un modo TV con dos líneas gigantes y el QR; **el stream** tiene un overlay transparente para OBS.
- **Después de la charla**, los exports SRT/VTT/TXT quedan listos para YouTube.

Lo vibe-codeé con Claude Code: un spec por feature con historias de usuario y criterios de aceptación, un agente de backend y otro de frontend en paralelo contra un backend falso que reproduce transcripciones reales, y cada decisión registrada en `docs/decisions.md`. Todos los números de abajo salen de `bench/` y `docs/pricing.md` y se regeneran con un comando.

## Calidad

- **Contexto de cada charla.** A partir del título y el abstract de la agenda, Gemini arma un vocabulario técnico, una lista de términos que no se traducen y correcciones automáticas. El dashboard muestra cuántas veces acertó cada término ("Kubernetes ✓ 9"), así el operador ve que funciona.
- **Frases, no párrafos.** La Live API mantiene una emisión abierta mientras el orador no hace una pausa (90 s en mis muestras) y sigue revisando palabras anteriores. Un segmentador LocalAgreement corta frases desde los parciales, en fin de oración, en una coma después de ~8 palabras o a los 4,5 s, y deduplica contra lo ya publicado alineando palabras.
- **Traducción con contexto.** Cada frase se traduce con el glosario de la charla y las 3 frases anteriores, en una sola llamada que devuelve todos los idiomas.
- **La prueba está en el video:** sus subtítulos en español los produjo el propio sistema sobre una charla real de FOSDEM 2025 en inglés, llena de términos técnicos.

## Latencia

- De que se oye la frase a que aparece el subtítulo en español: **p50 de 2,59 s** en clave gratuita y red local. El subtítulo original, 0,78 s.
- Lo que la bajó: una sola llamada de traducción en streaming, con `es` primero en el esquema y publicado en cuanto cierra (2,28 s → 1,33 s), y conexiones HTTPS mantenidas vivas (primera llamada tras una pausa, 1,8 s → 1,1 s).
- Con un proyecto facturado y el segmentador rápido, de oído a original: p50 0,52 s / p95 1,5 s.
- **Latencia honesta:** el dashboard muestra la demora medida (p50/p95) por sala y dice "Con demora" cuando la hay. El teléfono muestra la demora real, nunca una estimación.
- Dos ideas obvias (cerrar emisiones en la pausa con `audioStreamEnd` y con `silenceDurationMs`) las medí y las descarté; está documentado en `docs/decisions.md`.

## Escalabilidad

- **Cada sala se procesa una vez.** Una sesión de transcripción por sala, no por idioma ni por espectador. Un solo stream SSE por sala lleva todos los idiomas, así que cambiar de idioma no reconecta y el costo de IA depende de salas × horas, nunca del público.
- **Medido:** 8 salas × 250 espectadores = **2.000 espectadores** en un escritorio, cada frase entregada a todos con 7 ms (p50) / 11 ms (p95) de diferencia, 44 % de un núcleo, de 103 a 157 MB de RAM (`docs/scale.md`).
- **Sin grandes cambios:** hasta 10–15 salas en una laptop o un contenedor de 2 vCPU. Más allá, se separan los roles `worker` y `web` con Redis pub/sub en lugar del EventBus en proceso (misma interfaz) y se replican los `web` detrás de un CDN.
- **Sesiones que no se caen:** las sesiones de Gemini Live duran ~10 min, así que rotan *make-before-break* en una pausa del orador y se reconectan solas reenviando el audio en buffer. Verificado con rotaciones forzadas cada 30 s: 0 duplicados, 0 huecos.
- **Cuotas:** ante un 429 un segundo modelo toma el relevo, y bajo carga varias frases viajan en un mismo pedido.

## Despliegue y operación

- **Instalación sin conocimientos técnicos.** Un instalador `.exe` para Windows abre el asistente de configuración: clave de Gemini (con "Probar", que explica cualquier error en palabras simples), contraseña, acceso desde internet y salas. Un técnico de sonido lo pone en marcha solo, sin terminal ni desarrollador.
- **Salir a internet sin saber de redes.** Un checklist de 4 pasos detecta Tailscale, inicia sesión, activa Funnel y prueba la dirección pública desde afuera. También túnel con nombre de Cloudflare, servidor propio, o "solo este Wi-Fi" para probar.
- **Agenda pegada, salas listas.** Se pega la agenda tal como está en la web del evento y Gemini la convierte en salas, charlas y horarios, y prepara el vocabulario de cada una.
- **Cualquier fuente de audio.** La laptop de la sala conectada a la consola (vúmetro, "Probar audio", buffer de 10 s por si el Wi-Fi falla), un link de YouTube o de stream, un archivo de audio, o RTMP/SRT desde OBS.
- **Operación en lenguaje llano.** El dashboard muestra cada sala como En vivo, Sin audio o Con demora, la última línea escrita, y cada alerta viene con el botón que la resuelve.
- Para servidores, `docker compose up`. Para probarlo en un minuto sin clave, `npm run dev:fake`.

## Innovación

- **Subtitula videos, no solo charlas en vivo.** Se sube un video o se pega un link de YouTube y vuelve con los subtítulos traducidos incrustados, más VTT/SRT.
- **"¿Qué me perdí?"** Un resumen por sala, actualizado cada minuto y compartido por todos, para quien llega tarde.
- **Modo bilingüe** en el teléfono, y **modo demora de stream** para quien mira la charla por YouTube con retraso.
- **Overlay para OBS** con fondo transparente y configurador con vista previa en el dashboard, y **modo TV** con el QR y una tarjeta de pausa con la próxima charla.
- **Exports re-sincronizados:** como la latencia del ASR varía, los SRT/VTT re-timean cada frase sobre su tramo real de audio.
- **Vocabulario visible:** el operador ve cada término técnico y cuántas veces se reconoció.

## Precio

- **US$ 0,77 por sala-hora** con español, US$ 0,82 con español + portugués (estimado a precios de lista; medido en una corrida real, US$ 0,61).
- Un día de Nerdearla (10 salas × 9 h): **US$ 74**, contra US$ 398 con Gemini Live Translate y US$ 367 con OpenAI, que abren una sesión por idioma.
- La transcripción solo corre mientras alguien habla (los silencios de más de 2 s no se envían), y el público no suma costo.

## Qué sigue

Un proyecto con facturación para eventos reales, compresión Opus para el audio de la estación, réplicas `web` detrás de un CDN, y un modelo local (Gemma) para eventos sin conexión.

## Built with

gemini-live, gemini-flash-lite, google-genai, typescript, node.js, fastify, react, vite, electron, ffmpeg, yt-dlp, docker, server-sent-events, websockets, tailscale, cloudflare-tunnel, mediamtx, vitest, claude-code
