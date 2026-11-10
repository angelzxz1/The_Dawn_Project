# Guía del código de Dawn

Esta guía explica cómo está organizado el código de The Dawn Project: qué
hace cada carpeta y cada archivo, y cómo encajan las piezas. Está pensada
para leerse de arriba abajo la primera vez y después como consulta.

Convenciones que se repiten en todo el proyecto:

- **Las pruebas viven junto al código.** `x.test.ts` prueba `x.ts`;
  `x.test.tsx` es una prueba de componente (se ejecuta en un navegador
  real con Vitest). Esta guía no lista cada prueba por separado.
- **Cada archivo empieza con un comentario** que dice qué es. Si esta guía
  se queda corta, ese comentario es la fuente más precisa.
- **"Paridad" (parity)**: muchos procesos de audio existen dos veces, en
  JavaScript (el motor del navegador) y en Rust (el motor nativo). Los
  archivos `*Parity.ts` generan casos de prueba en JavaScript y los
  `*_parity.rs` comprueban que Rust da exactamente el mismo resultado.

---

## 1. Visión general

Dawn es una estación de trabajo de audio digital (DAW) que funciona de dos
maneras:

1. **En el navegador**: un sitio estático hecho con Next.js. La web
   pública está en `/` y el estudio en `/app`. El audio se procesa con
   Web Audio, Tone.js y AudioWorklets.
2. **Como aplicación de escritorio**: el mismo estudio dentro de una
   ventana de Tauri 2, con un lado en Rust que añade un **motor de audio
   nativo** (tarjetas de sonido de verdad, ASIO, grabación con baja
   latencia) y el **alojamiento de plugins VST3 y CLAP**.

```
                ┌──────────────────────────────────────────────┐
                │  Estudio (React, src/studio)                 │
                │  ↕ projectStore (estado + deshacer)          │
                └───────────────┬──────────────────────────────┘
                                │
          ┌─────────────────────┴──────────────────────┐
          │                                            │
  Motor del navegador                         Motor nativo (escritorio)
  src/engine/audioEngine.ts                   src/engine/native/*.ts
  Web Audio + Tone.js + Worklets                    │ (comandos Tauri)
                                              src-tauri/src/audio/*.rs
                                                    │
                                              crates/dawn-engine (DSP)
                                              crates/dawn-plugins (VST3/CLAP)
```

Cuando el motor nativo está encendido, el motor del navegador sigue
funcionando en silencio y le "presta" el transporte: el nativo lo sigue
(`src/engine/follower.ts`) y es el que suena.

---

## 2. La raíz del repositorio

| Archivo / carpeta | Para qué es |
|---|---|
| `README.md` | Presentación del proyecto, guía de usuario completa, atajos de teclado y la sección de desarrollo. |
| `HANDOFF.md` | Estado del trabajo para quien continúe: qué pasos están hechos (con su commit), qué sigue y las reglas de trabajo. |
| `IMPROVEMENTS.md` | Lista de mejoras revisadas contra el código, con `[x]` y el commit que las hizo. |
| `nextSteps.md` | Plan por pasos (fases y pasos numerados). Es local: está en `.gitignore`. |
| `LICENSE.md` | La licencia del proyecto. |
| `AGENTS.md`, `CLAUDE.md` | Instrucciones para asistentes de código (`next dev` reescribe `AGENTS.md`). |
| `package.json` | Dependencias de JavaScript y los scripts: `dev`, `build`, `test`, `test:e2e`, `test:engine`, `desktop`, `desktop:build`, `lint`, `typecheck`. |
| `Cargo.toml` / `Cargo.lock` | El *workspace* de Rust: `crates/dawn-engine`, `crates/dawn-plugins`, `crates/dawn-test-plugin` y `src-tauri`. Compila el motor optimizado incluso en debug. |
| `next.config.ts` | Configuración de Next: exportación estática a `out/`, la versión de la app. |
| `tsconfig.json` | TypeScript (el alias `@/` apunta a `src/`). |
| `eslint.config.mjs`, `postcss.config.mjs` | Lint y Tailwind CSS 4. |
| `vitest.config.ts` | Las pruebas de JavaScript, en proyectos: `unit` (Node) y `components` (navegador). |
| `playwright.config.ts` | Las pruebas de extremo a extremo (`e2e/`) contra el sitio ya compilado en `out/`. |
| `railpack.json` | Configuración del proveedor de despliegue. |
| `.github/workflows/` | Integración continua: `ci.yml` (tipos, lint, pruebas, e2e y Rust), `desktop.yml` (compila la app de escritorio en Windows, macOS y Linux), `installers.yml` (crea los instaladores .msi/.exe/.dmg). |
| `.vscode/settings.json` | Ajustes del editor. |

Carpetas generadas (no se editan): `out/` (el sitio compilado), `target/`
(compilación de Rust), `node_modules/`, `test-results/`.

---

## 3. `scripts/` — tareas de compilación

| Archivo | Qué hace |
|---|---|
| `desktop.mjs` | Ejecuta la CLI de Tauri (`dev` o `build`). Activa ASIO si `.env` tiene `DAWN_ASIO=1`. |
| `build-sw.mjs` | Antes de `next build`: escribe `public/sw.js` desde la plantilla con un id de compilación nuevo. |
| `sw.template.js` | El *service worker*: permite instalar Dawn y abrirlo sin conexión. |
| `fix-export-segments.mjs` | Después de `next build`: renombra los archivos de *prefetch* de la exportación estática (en Windows salen con el nombre equivocado). |
| `fonts.mjs` | Descarga las fuentes de Google Fonts a `src/fonts/` con sus licencias y genera el código que las carga. Solo se ejecuta para cambiar fuentes. |

---

## 4. `docs/` — documentación técnica

| Archivo | Contenido |
|---|---|
| `desktop.md` | La app de escritorio: cómo se compila, el motor nativo, los plugins, la grabación, ASIO. |
| `deploy.md` | Cómo desplegar el sitio estático y las variables de entorno (`NEXT_PUBLIC_*`). |
| `tones.md` | Cómo añadir capturas de amplificador (NAM) e IRs de bafle. |
| `guia-del-codigo.md` | Esta guía. |

---

## 5. `public/` — archivos servidos tal cual

| Ruta | Qué es |
|---|---|
| `_headers` | Cabeceras HTTP para el hosting (aislamiento de origen, caché). |
| `banner.png`, `logo-icon.png`, `icons/` | Imagen para redes sociales e iconos de la app instalable. |
| `site/studio.webp` | Captura del estudio para la web. |
| `nam/` | El motor NAM (Neural Amp Modeler) compilado a WebAssembly (`nam-engine.wasm`, `nam-worklet.js`) con sus licencias y README. |
| `tones/manifest.json` | La lista de capturas de amplificador e IRs incluidas (ver `docs/tones.md`). |

---

## 6. `src/` — la aplicación web (el estudio y el sitio)

### 6.1 `src/app/` — las rutas de Next.js

| Ruta | Qué es |
|---|---|
| `layout.tsx` | El HTML raíz de todo: fuentes, tema, metadatos. |
| `globals.css` | Estilos globales y los colores de los temas (Tailwind). |
| `manifest.ts` | El manifiesto que hace a Dawn instalable. |
| `robots.ts`, `sitemap.ts` | Para buscadores (el estudio queda fuera). |
| `not-found.tsx` | La página 404. |
| `favicon.ico`, `icon.png` | Iconos. |
| `app/page.tsx` | **El estudio** (`/app`): carga `src/studio/Daw.tsx` solo en el cliente. |
| `app/layout.tsx` | Envoltorio de la ruta del estudio. |
| `app/error.tsx` | Pantalla de error si el estudio falla al dibujarse (ofrece recuperar el proyecto). |
| `(site)/layout.tsx` | El marco de la web pública (cabecera y pie). |
| `(site)/page.tsx` | La portada. |
| `(site)/features/`, `how-it-works/`, `faq/`, `support/`, `credits/`, `license/`, `privacy/` | Las páginas de la web. |
| `(site)/guides/` | Las guías; `guides/daybreak/` es la guía del sintetizador. |

### 6.2 `src/site/` — piezas de la web pública

| Archivo | Qué hace |
|---|---|
| `SiteChrome.tsx` | Cabecera, navegación y pie de la web. |
| `ui.tsx` | Bloques comunes: maquetación, tipografía, botones, el motivo del sol. |
| `illustrations.tsx` | Dibujos de las partes de Dawn (cadenas de señal, curvas de EQ, piano roll…). |
| `interactive.tsx` | Piezas interactivas (preguntas desplegables, etc.). |
| `guide.tsx` | La maquetación de una guía: índice al lado y secciones. |
| `LegalPage.tsx`, `PrivacyPolicy.tsx` | Créditos, licencia y privacidad. |
| `siteLinks.ts`, `siteUrl.ts` | Adónde llevan los botones y la dirección del sitio. |
| `siteFonts.ts` | Las fuentes de la web. |

### 6.3 `src/content/` — textos y datos

| Archivo | Qué contiene |
|---|---|
| `faq.ts` | Preguntas frecuentes. |
| `guides.ts`, `daybreakGuide.ts` | El contenido de las guías. |
| `tiers.ts` | Las membresías de apoyo. |
| `supporters.ts` / `supporters.json` | Los miembros que se agradecen en los créditos. |
| `credits.ts` / `licenses.json` | Las bibliotecas y archivos de terceros que usa Dawn y sus licencias. |
| `whatsNew.ts` | Las notas de cada versión (panel "Novedades"). |

### 6.4 `src/fonts/` — fuentes locales

Generado por `scripts/fonts.mjs` (no editar a mano). `geist.ts` (la
interfaz), `plugin.ts` (las ventanas de efectos), `site.ts` (la web),
`alphabets.css`, `licenses/` y un `README.md`.

---

### 6.5 `src/project/` — el modelo del proyecto (lógica pura)

Aquí está **qué es un proyecto** y las operaciones sobre él. Casi todo son
funciones puras (sin audio ni React), por eso es lo más probado.

| Archivo | Qué hace |
|---|---|
| `types.ts` | Los tipos: pista, clip, nota, bus, efecto, automatización… |
| `project.ts` | El "documento": todo lo que deshacer/rehacer y guardar necesitan. |
| `projectSchema.ts` | Convierte un proyecto guardado (de cualquier versión anterior) en uno que el código actual puede usar sin fallar. |
| `projectFiles.ts` | Proyectos en disco: una carpeta con el proyecto, su audio y sus copias. |
| `persistence.ts` | Autoguardado en IndexedDB (con el audio), para que recargar no pierda nada. |
| `projectRecovery.ts` | Si un proyecto no abre: lo respalda, lo limpia y recarga. |
| `sharedFiles.ts` | Varios clips pueden usar el mismo archivo; al guardar se escribe una sola vez. |
| `dawnPack.ts`, `packStore.ts` | El formato `.dawnpack` (paquetes de sonidos) y los paquetes instalados. |
| `templates.ts`, `demoSong.ts` | Las plantillas de la pantalla de inicio y la canción de demostración. |
| `musicTime.ts` | Compases y rejilla en tiempos (negras). |
| `tempoMap.ts`, `tempoEdits.ts` | El mapa de tempo y mantener la canción en su sitio cuando cambia. |
| `warp.ts` | *Warping*: un clip de audio que sigue el tempo de la canción. |
| `timeRange.ts` | Editar un rango de tiempo en varias pistas (borrar, insertar, duplicar). |
| `clipEdits.ts`, `curveEdits.ts` | Ediciones de clips (nombre, fundidos, normalizar) y dibujo de curvas. |
| `takes.ts`, `punch.ts` | Tomas y *comping*; *punch-in/out*. |
| `markers.ts`, `arrangementLoop.ts` | Marcadores de sección y el bucle del arreglo. |
| `automationTargets.ts` | Qué puede automatizar un carril (volumen, panorama, parámetros). |
| `chords.ts`, `scales.ts` | Nombrar acordes y resaltar escalas. |
| `silentStates.ts` | Por qué una pista no suena (otra en solo, fader abajo…). |
| `colors.ts`, `trackHeight.ts` | Colores de pista y alturas de fila. |
| `__fixtures__/saved-projects/` | Proyectos guardados de versiones antiguas para las pruebas. |

### 6.6 `src/state/` — el proyecto abierto y las acciones

El **almacén** del proyecto vive fuera de React para que cualquier parte lo
lea siempre actualizado. Cada acción cambia el proyecto **y** el motor de
audio a la vez, como un solo paso de deshacer.

| Archivo | Qué hace |
|---|---|
| `projectStore.ts` | El proyecto abierto con su historial de deshacer/rehacer. |
| `projectDocument.ts` | El proyecto como documento guardado y viceversa. |
| `trackActions.ts` | Pistas: añadir, quitar, renombrar, fader, mute, solo, armar, enrutado… |
| `clipActions.ts` | Clips: añadir, mover, cortar, duplicar, fundidos, notas, copiar/pegar. |
| `clipEditActions.ts` | Renombrar, colorear, normalizar, invertir, consolidar. |
| `rangeActions.ts` | Acciones sobre la selección de tiempo. |
| `effectActions.ts` | Cadenas de efectos: añadir, mover, bypass, presets. |
| `busActions.ts` | Buses de envío/retorno. |
| `markerActions.ts`, `takeActions.ts` | Marcadores y tomas. |
| `trackClips.ts` | Cambiar clips de varias pistas en un solo paso. |
| `clipboard.ts`, `effectClipboard.ts` | Portapapeles de clips/notas y de efectos. |
| `audioBlobs.ts` | El audio (Blob) de cada clip. |
| `ids.ts` | Ids nuevos ("ch-3", "clip-12"). |
| `studioPrefs.ts` | Preferencias del estudio (cuenta atrás, autoguardado, tema, tamaño). |

### 6.7 `src/engine/` — el motor de audio del navegador

| Archivo | Qué hace |
|---|---|
| `audioEngine.ts` | **El motor**: construye las pistas, buses, master y efectos con Web Audio/Tone.js, reproduce, graba, mide. El archivo central del audio. |
| `context.ts` | El `AudioContext` (48 kHz) y cuánto se adelanta la programación. |
| `engineSync.ts` | Hace que el motor coincida con el proyecto (al abrir: desde cero; al deshacer: solo lo que cambió). |
| `nodes.ts` | Qué nodos forman una pista, un bus y un efecto. |
| `transport.ts` | El transporte (play, stop, saltar, tempo, bucle) con el metrónomo sincronizado. |
| `metronome.ts`, `metronomeKernel.ts`, `clickSounds.ts` | El metrónomo y la cuenta atrás, en un AudioWorklet. |
| `routing.ts`, `mixGraph.ts` | Adónde va el audio de cada pista (grupos, "Audio To/From") y el plan de la mezcla. |
| `latency.ts`, `nativeLatency.ts` | Compensación de retardo de plugins (PDC) y la latencia oculta de los nodos del navegador. |
| `automation.ts` | El valor de un carril de automatización en cada momento. |
| `inputs.ts` | Las entradas de audio por pista y la monitorización. |
| `inputRecorder.ts` | Graba la entrada con precisión de muestra (AudioWorklet). |
| `midiTake.ts`, `webMidi.ts` | Grabar MIDI y los teclados MIDI (Web MIDI). |
| `audioFile.ts`, `waveform.ts` | Decodificar audio y los datos para dibujar formas de onda. |
| `clipAudio.ts` | Mezclar clips a muestras (para consolidar e invertir). |
| `timeStretch.ts`, `warpRender.ts` | Estirar el tiempo (WSOLA) para clips con *warp*, con caché. |
| `tempoDetect.ts`, `onsets.ts` | Detectar el tempo y dónde empiezan las notas. |
| `levelMeter.ts`, `loudness.ts`, `loudnessKernel.ts`, `cpuMeter.ts` | Medidores: nivel, loudness (LUFS) y carga de CPU. |
| `audioPrefs.ts` | Ajustes de audio de este ordenador (latencia, metrónomo, motor nativo). |
| `follower.ts` | Otro motor (el nativo) siguiendo el transporte de este. |
| `workletLoader.ts` | Carga los módulos de AudioWorklet una vez por contexto. |
| `clipParity.ts`, `metronomeParity.ts` | Casos de paridad para el motor Rust. |

#### `src/engine/native/` — el motor nativo visto desde el estudio

| Archivo | Qué hace |
|---|---|
| `bridge.ts` | Las llamadas a los comandos de Tauri (solo en la app de escritorio). |
| `describe.ts` | Convierte el proyecto en la "canción" que entiende el motor nativo. |
| `nativeEngine.ts` | Encender/apagar el motor nativo, enviarle la canción, su estado, las ventanas de plugins. |
| `nativeTake.ts` | Una toma grabada por el motor nativo: su forma de onda en vivo. |
| `plugins.ts` | La lista de plugins VST3/CLAP encontrados en el ordenador. |

### 6.8 `src/effects/` — los efectos

Cada efecto es **una carpeta** con la misma forma:

| Archivo de cada carpeta | Para qué |
|---|---|
| `index.ts` | Qué es: clave, nombre, grupo en el navegador y parámetros. |
| `audio.ts` | Cómo se construye su nodo de audio y cómo se aplica un parámetro. |
| `ui.ts` | Su tarjeta del rack y su ventana. |
| `*Model.ts` / `*Kernel.ts` | El DSP (a menudo como texto fuente para ejecutarse en un AudioWorklet). |
| `*Chain.ts` o `<nombre>.ts` | El nodo de audio real (AudioWorklet o nodos de Web Audio). |
| `*RackCard.tsx`, `*Window.tsx`, `*Graph.tsx`, `*Meter.tsx` | La interfaz: tarjeta compacta, ventana grande, gráficas y medidores. |
| `*Curve.ts` | Datos para la gráfica de la ventana. |
| `*Parity.ts` | Casos de paridad para el puerto en Rust. |

Los efectos:

| Carpeta | Efecto |
|---|---|
| `compressor/` | Compresor (con sidechain). |
| `glue/` | Glue Compressor (compresor de bus estilo consola). |
| `crusher/` | Crusher (compresor con carácter y distorsión: ratios de 1:1 a Nuke, British Mode, Dist 2 y Dist 3). |
| `gate/` | Noise Gate. |
| `limiter/` | Limitador *brick-wall* con *lookahead*. |
| `multiband/` | Compresor multibanda. |
| `multiband-dynamics/` | Dinámica multibanda (arriba/abajo por banda). |
| `parametric-eq/`, `eq-three/` | EQ paramétrico y EQ de tres bandas. |
| `filter/` | Filtro con LFO. |
| `chorus/`, `delay/`, `reverb/` | Modulación y espacio. |
| `saturator/` | Saturación (el tipo `distortion`). |
| `pitch-shift/` | Cambio de tono. |
| `utility/` | Ganancia, panorama, anchura, fase, medidores. |
| `tuner/` | Afinador. |
| `tremor/` | Tremor (amplificador de bajo con tres voces: Tube, Grind y Split). |
| `furnace/` | Amplificador de válvulas modelado etapa por etapa, con cinco amplificadores (Clean American, Chime, British Crunch, British Lead y High Gain). |
| `nam-amp/` | Amplificador NAM (redes neuronales, motor WebAssembly en `public/nam/`). |
| `ir-loader/` | Cargador de IRs (bafles); `cabIrs.ts` genera los bafles propios de Dawn. |
| `plugin/` | Un plugin VST3/CLAP del ordenador como efecto. En el navegador el sonido pasa tal cual; suena en el motor nativo. |
| `sidechain/` | Piezas compartidas del sidechain: panel, modelo y enrutado. |
| `ui/` | Piezas comunes de las ventanas: cabecera (`PluginChrome.tsx`), menú de presets, ranura de archivo, el registro de interfaces. |

Archivos sueltos de `src/effects/`:

| Archivo | Qué hace |
|---|---|
| `types.ts` | Las formas que rellena cada carpeta de efecto. |
| `registry.ts` | La lista de todos los efectos, reunida de cada `index.ts`. |
| `nodes.ts` | Construye el nodo de cualquier efecto (lo usan el motor y la exportación). |
| `presets.ts` | Presets de fábrica y del usuario. |
| `chains.ts`, `userChains.ts` | Cadenas preparadas y las guardadas por el usuario. |
| `effectFiles.ts` | Archivos subidos a los efectos (IRs, modelos). |
| `format.ts` | Cómo se muestran los valores de los parámetros. |

### 6.9 `src/instruments/` — los instrumentos

Igual que los efectos: una carpeta por instrumento con `index.ts`,
`audio.ts` y `ui.tsx`.

| Carpeta / archivo | Qué es |
|---|---|
| `synth/` | **Daybreak**, el sintetizador de *wavetables*: `synthKernel.ts` (DSP), `synthParams.ts` (todos sus ajustes), `wavetableModel.ts`, `synthPresets.ts`, `SynthWindow.tsx`/`SynthUi.tsx`/`SynthDisplays.tsx`/`synthViz.ts` (la ventana y sus dibujos). |
| `drum-rack/` | El Drum Rack: 16 pads con voces sintetizadas o muestras; `drumKernel.ts`, `drumKits.ts`, `drumParams.ts`, `DrumRackWindow.tsx`, `DrumPads.tsx`. |
| `piano/` | El piano muestreado (Salamander) y el teclado QWERTY como teclado MIDI. |
| `instrument.ts` | La interfaz común con la que el motor toca un instrumento. |
| `registry.ts`, `nodes.ts`, `types.ts` | El registro, la construcción y los tipos. |
| `ui/` | El registro de iconos, tarjetas y ventanas. |

### 6.10 `src/export/` — exportar

| Archivo | Qué hace |
|---|---|
| `bounce.ts` | Renderiza el proyecto *offline* (más rápido que tiempo real) igual que el motor en vivo. |
| `exportProject.ts` | Del diálogo de exportar a un archivo: mezcla, bucle o *stems* en ZIP. |
| `exportFormats.ts` | Ajustes, normalización, etiqueta ID3, nombres de *stems*. |
| `wav.ts` | Codificación WAV (16, 24 y 32 bits). |
| `mp3.ts`, `mp3Encode.ts` | MP3 con lamejs en un Web Worker. |
| `midiFile.ts` | Leer archivos MIDI estándar. |

### 6.11 `src/library/` — la biblioteca de sonidos

| Archivo | Qué hace |
|---|---|
| `grooves.ts` | Patrones de batería propios. |
| `tones.ts` | Los tonos para NAM Amp e IR Loader. |
| `previews.ts` | Qué suena al previsualizar un efecto o preset. |
| `browserPicks.ts` | Favoritos y recientes del navegador. |

### 6.12 `src/services/` — servicios externos

| Archivo | Qué hace |
|---|---|
| `desktop.ts` | Saber si se está dentro de la app de escritorio. |
| `support.ts` | Adónde van "Apoyar a Dawn" y "Comentarios" (Discord). |
| `telemetry.ts` | Estadísticas de uso y errores (solo si están configuradas y permitidas). |
| `issues.ts` | Problemas que el estudio supera solo, guardados para diagnosticar. |

### 6.13 `src/studio/` — la interfaz del estudio

| Archivo / carpeta | Qué contiene |
|---|---|
| `Daw.tsx` | **El estudio entero**: une el almacén, el motor y todas las vistas; atajos y gestos. El archivo más grande de la interfaz. |
| `contextMenus.tsx` | Los menús de clic derecho del arreglo. |
| `useProjectFiles.ts` | Autoguardado y guardar/abrir carpetas de proyecto. |
| `shell/` | El marco: barra de menús (`MenuBar.tsx`), paleta de comandos, menú contextual, hoja de atajos, el tour, el tema (`theme.ts`, `themeBoot.ts`), actualizaciones (`AppUpdater.tsx`) y el aviso para móviles (`DesktopOnly.tsx`). |
| `transport/` | La barra de transporte (`TransportBar.tsx`, reloj, cuenta atrás), el bucle, marcadores y carril de tempo, nivel del metrónomo, estado del audio/CPU (`AudioStatus.tsx`), aviso de latencia y la sección del motor nativo (`NativeEngineSection.tsx`). |
| `timeline/` | El arreglo: regla, cabezal, barra de desplazamiento, clips (`ClipBlock.tsx`), forma de onda, la toma que se graba, herramientas, *snap*, zoom y medidas (`layout.ts`). |
| `tracks/` | Cada pista: cabecera (`TrackHeader.tsx`), carril (`TrackLane.tsx`), carriles de automatización y de tomas, medidores, el master, monitorización, selector de canal de entrada. |
| `mixer/` | El mezclador: tiras de canal, buses, master (`Mixer.tsx`, `Fader.tsx`). |
| `notes/` | El piano roll (`PianoRollEditor.tsx`), el teclado en pantalla, pitch bend/mod wheel, selector de escala. |
| `rack/` | El rack de efectos (`FxRack.tsx`), los navegadores de efectos, grooves, tonos y plugins, la ventana de efecto y el arrastre. |
| `dialogs/` | Ventanas: pantalla de inicio, menú Archivo, Exportar, Preferencias, Paquetes, Acerca de, recuperación, telemetría, comentarios. |

### 6.14 `src/ui/` — componentes y utilidades de interfaz compartidos

| Archivo | Qué hace |
|---|---|
| `shortcuts.ts` | Todos los atajos de teclado, por capas. |
| `keyLabel.ts`, `commandSearch.ts` | Cómo se leen los atajos y qué muestran la paleta y la hoja. |
| `DeviceWindow.tsx` | El marco común de las ventanas de efectos e instrumentos. |
| `PluginKnob.tsx`, `knobInput.ts`, `useKnobWheel.ts` | Las perillas y cómo responden al ratón. |
| `Popout.tsx`, `hostWindow.ts` | Sacar partes del estudio a otra ventana (segunda pantalla). |
| `pluginFonts.ts` | La tipografía de las ventanas de efectos. |
| `useStableActions.ts` | Manejadores estables para filas memorizadas. |

### 6.15 `src/workers/` y `src/test/`

- `workers/mp3.worker.ts`: codifica MP3 fuera del hilo principal.
- `test/`: utilidades de prueba: preparación de componentes, arrastres del
  ratón, la fuente de Next simulada, y las herramientas de paridad
  JavaScript ↔ Rust (`kernelParity.ts`, `webAudioParity.ts`,
  `engineFixtures.ts`).

---

## 7. `e2e/` — pruebas en el navegador (Playwright)

Una prueba por área (`transport.spec.ts`, `recording.spec.ts`,
`mixer.spec.ts`, `pianoRoll.spec.ts`…), ejecutadas contra el sitio
compilado. Ayudantes:

| Archivo | Qué hace |
|---|---|
| `fixtures.ts` | El punto de partida de cada prueba (tour visto, sin red externa, sin errores). |
| `studio.ts` | Manejar el estudio desde su interfaz (abrir plantillas, encontrar pistas, clips, el rack). |
| `speakers.ts` | Escuchar lo que suena: encuentra cada clic con precisión de muestra. |
| `wav.ts` | Crear WAVs de prueba y leer los exportados. |

---

## 8. `crates/` — el código Rust

### 8.1 `crates/dawn-engine/` — el motor de audio nativo

Una biblioteca pura de Rust (sin dispositivos ni ventanas): toma una
descripción de la canción y produce muestras.

| Archivo | Qué hace |
|---|---|
| `src/lib.rs` | La entrada de la biblioteca. |
| `src/params.rs` | Parámetros de efecto por clave, como en la web. |
| `src/mix/mod.rs` | El módulo de la mezcla. |
| `src/mix/song.rs` | La canción preparada para el hilo de audio (clips en frames, ganancias, orden de mezcla). |
| `src/mix/engine.rs` | **El motor**: transporte, mezcla (tiras, enrutado, envíos, buses, master), limitador y metrónomo; `render` llena el búfer del dispositivo. También la entrada en vivo para grabar. |
| `src/mix/clip.rs` | Qué suena de un clip de audio en cada momento. |
| `src/mix/player.rs` | El instrumento de una pista MIDI: notas de los clips y teclas en vivo. |
| `src/mix/fx.rs` | Los efectos de una cadena, que sobreviven de una versión de la canción a la siguiente; también la ranura de los plugins. |
| `src/mix/keys.rs` | Sidechains: quién controla a quién y el orden de la mezcla. |
| `src/mix/latency.rs` | Compensación de retardo, igual que `src/engine/latency.ts`. |
| `src/mix/automation.rs` | Automatización de volumen, panorama y parámetros. |
| `src/mix/metronome.rs`, `src/mix/tempo.rs` | El metrónomo y el mapa de tempo. |
| `src/effects/` | Un módulo por efecto, puerto exacto del de la web (`compressor.rs`, `reverb.rs`, `amp.rs`…), más los nodos del navegador reimplementados como los ejecuta Chromium (`biquad_node.rs`, `convolver.rs`, `delay_node.rs`, `wave_shaper.rs`, `tone_lfo.rs`). `mod.rs` lista los tipos ya portados. |
| `src/instruments/` | `synth.rs` (Daybreak), `drums.rs` (Drum Rack), `piano.rs`. |
| `tests/*_parity.rs` | Comparan cada puerto con los casos generados por JavaScript. |
| `tests/fixtures/` | Los casos guardados (`.rs` + `.bin`). |
| `tests/mix.rs`, `latency.rs`, `sidechain.rs`, `automation.rs`, `effects.rs`, `instruments.rs` | Pruebas del motor completo. |

### 8.2 `crates/dawn-plugins/` — plugins VST3 y CLAP

| Archivo | Qué hace |
|---|---|
| `src/lib.rs` | La entrada: tipos comunes de un plugin encontrado. |
| `src/folders.rs` | Dónde guarda cada sistema los plugins y cómo encontrar los archivos. |
| `src/vst3.rs` | Leer un módulo VST3 (su `moduleinfo.json` o su fábrica). |
| `src/clap.rs` | Leer un archivo CLAP (su fábrica y sus *features*). |
| `src/scan.rs` | El escaneo: cada archivo se lee en un proceso aparte (si un plugin falla, no tumba la app) y el resultado se guarda en caché. |
| `src/host.rs` | Ejecutar plugins CLAP: la instancia en el hilo principal y su procesador en el hilo de audio. |
| `src/vst3_host.rs` | Ejecutar plugins VST3: componente, procesador y controlador; los objetos COM que el host le da (flujos, mensajes, manejador de componentes, marco de ventana). |
| `src/bin/dawn-plugin-scan.rs` | El proceso de escaneo por separado, para las pruebas. |
| `tests/scan.rs`, `tests/host.rs`, `tests/common/` | Pruebas del escaneo y de la ejecución con el plugin de prueba. |

### 8.3 `crates/dawn-test-plugin/` — un plugin para las pruebas

Una biblioteca que es a la vez un archivo CLAP y un módulo VST3, con dos
plugins: "Dawn Test Gain" (efecto) y "Dawn Test Tone" (instrumento).
`src/clap.rs` es el lado CLAP, `src/vst3.rs` el lado VST3, `src/lib.rs`
une ambos.

---

## 9. `src-tauri/` — la aplicación de escritorio

| Archivo | Qué hace |
|---|---|
| `Cargo.toml` | Dependencias del lado Rust de la app (Tauri, cpal para el audio, los crates de Dawn). |
| `tauri.conf.json` | Configuración de Tauri: ventana, el sitio `out/` como interfaz, instaladores. |
| `build.rs` | El script de compilación de Tauri. |
| `capabilities/default.json` | Qué puede pedir la página al lado nativo. |
| `Info.plist`, `Entitlements.plist` | Permisos de macOS (micrófono, etc.). |
| `icons/` | Iconos de la app. |
| `src/main.rs` | Arranque: si se lanzó para escanear un plugin lo hace y sale; si no, abre la app. |
| `src/lib.rs` | La app: la ventana con el estudio y el registro de todos los comandos. |
| `src/plugins.rs` | El escaneo de plugins en segundo plano para el navegador del estudio. |
| `src/audio/mod.rs` | Los comandos que el estudio usa para manejar el motor nativo (`engine_set_song`, grabar, estado…). |
| `src/audio/devices.rs` | Los dispositivos de audio: drivers (WASAPI, ASIO, Core Audio, ALSA), salidas, entradas, frecuencias y búferes. |
| `src/audio/stream.rs` | El flujo de audio: el *callback* del dispositivo es dueño del motor; se comunica solo por colas sin bloqueos. Mide la latencia y los clics de prueba. |
| `src/audio/song.rs` | La canción tal como la envía el estudio, convertida en la canción del motor. |
| `src/audio/take.rs` | Las tomas grabadas: un anillo en el hilo de audio y un hilo que escribe el WAV. |
| `src/audio/hosted.rs` | Los plugins que ejecuta el motor, en el hilo principal: instancias, estados, ventanas. |

---

## 10. Cómo fluye todo: tres recorridos

**Mover un fader.**
`TrackHeader.tsx` → `trackActions.ts` (cambia el proyecto en
`projectStore.ts` y guarda el paso de deshacer) → `audioEngine.ts`
ajusta la ganancia. Si el motor nativo está encendido,
`nativeEngine.ts` vuelve a describir la canción (`describe.ts`) y la envía
a `src-tauri/src/audio/mod.rs`, que la convierte (`song.rs`) y se la pasa
al hilo de audio (`stream.rs` → `dawn-engine`).

**Añadir un efecto.**
`EffectBrowser.tsx` → `effectActions.ts` → el motor construye el nodo con
`src/effects/nodes.ts` y el `audio.ts` de esa carpeta; el rack muestra la
tarjeta del `ui.ts`. En el motor nativo, `dawn-engine/src/mix/fx.rs` crea
el efecto portado (o la ranura del plugin, vía `hosted.rs`).

**Grabar una toma.**
Navegador: `inputs.ts` + `inputRecorder.ts` capturan la entrada,
`takeActions.ts` archiva la toma. Escritorio: `stream.rs` lee la entrada,
`take.rs` escribe el WAV, `nativeTake.ts` dibuja la toma en vivo y al
terminar se coloca en la pista corrigiendo la latencia de ida y vuelta.

---

## 11. Comandos útiles

| Comando | Qué hace |
|---|---|
| `npm run dev` | El sitio y el estudio en modo desarrollo. |
| `npm run build` | Compila el sitio estático en `out/`. |
| `npm test` | Pruebas unitarias y de componentes (Vitest). |
| `npm run test:e2e` | Pruebas en el navegador (Playwright; requiere `npm run build`). |
| `npm run test:engine` | Pruebas del motor Rust. |
| `cargo test -p dawn-plugins` | Pruebas del alojamiento de plugins. |
| `npm run desktop` | La app de escritorio en desarrollo. |
| `npm run desktop:build` | Compila los instaladores de escritorio. |
| `npm run lint`, `npm run typecheck` | Lint y comprobación de tipos. |
