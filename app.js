(() => {
  'use strict';

  const loadState = document.getElementById('loadState');
  const measureBtn = document.getElementById('measureBtn');
  const areaBtn = document.getElementById('areaBtn');
  const clearBtn = document.getElementById('clearBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const measureHint = document.getElementById('measureHint');
  const notesHint = document.getElementById('notesHint');
  const addNoteBtn = document.getElementById('addNoteBtn');
  const toggleNotesBtn = document.getElementById('toggleNotesBtn');
  const exportNotesBtn = document.getElementById('exportNotesBtn');
  const importNotesInput = document.getElementById('importNotesInput');
  const detailSegment = document.getElementById('detailSegment');
  const container = document.getElementById('cesiumContainer');

  const viewBtns = {
    home: document.getElementById('homeBtn'),
    top: document.getElementById('topBtn'),
    front: document.getElementById('frontBtn'),
    back: document.getElementById('backBtn'),
    left: document.getElementById('leftBtn'),
    right: document.getElementById('rightBtn')
  };

  const isMobile = window.matchMedia('(max-width: 720px)').matches;
  const NOTES_STORAGE_KEY = 'block54_notes_v1';

  const viewer = new Cesium.Viewer('cesiumContainer', {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
    fullscreenButton: false,
    vrButton: false,
    baseLayer: false,
    globe: false,
    shadows: false,
    shouldAnimate: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity
  });

  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#101216');
  viewer.scene.skyBox.show = false;
  viewer.scene.skyAtmosphere.show = false;
  viewer.scene.sun.show = false;
  viewer.scene.moon.show = false;
  viewer.scene.fog.enabled = false;
  viewer.scene.pickTranslucentDepth = true;
  viewer.scene.postProcessStages.fxaa.enabled = true;
  const cameraController = viewer.scene.screenSpaceCameraController;
  cameraController.minimumZoomDistance = 0.2;
  cameraController.inertiaSpin = 0;
  cameraController.inertiaTranslate = 0;
  cameraController.inertiaZoom = 0;
  cameraController.enableLook = false;
  // HARD CAMERA LOCK v4:
  // Rotation/tilt are enabled ONLY while the relevant mouse button is physically held.
  cameraController.enableRotate = false;
  cameraController.enableTilt = false;
  cameraController.enableZoom = true;
  cameraController.enableTranslate = true;
  viewer.clock.shouldAnimate = false;
  viewer.trackedEntity = undefined;
  viewer.scene.tweens.removeAll();
  // Disable Cesium's default double-click entity tracking/zoom action.
  viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  const cameraCanvas = viewer.scene.canvas;
  let cameraGestureActive = false;

  function hardStopCameraGesture() {
    cameraGestureActive = false;
    cameraController.enableRotate = false;
    cameraController.enableTilt = false;
    viewer.camera.cancelFlight();
    viewer.trackedEntity = undefined;
    viewer.scene.tweens.removeAll();
    viewer.scene.requestRender();
  }

  cameraCanvas.addEventListener('pointerdown', (event) => {
    cameraGestureActive = true;
    viewer.camera.cancelFlight();
    viewer.scene.tweens.removeAll();
    cameraController.enableRotate = event.button === 0;
    cameraController.enableTilt = event.button === 1;
  }, true);

  window.addEventListener('pointerup', () => {
    window.setTimeout(hardStopCameraGesture, 0);
  }, false);
  window.addEventListener('pointercancel', hardStopCameraGesture, false);
  window.addEventListener('mouseup', () => {
    window.setTimeout(hardStopCameraGesture, 0);
  }, false);
  window.addEventListener('blur', hardStopCameraGesture, false);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hardStopCameraGesture();
  });

  cameraCanvas.addEventListener('pointermove', (event) => {
    if (cameraGestureActive && event.buttons === 0) hardStopCameraGesture();
  }, true);

  cameraCanvas.addEventListener('mouseleave', (event) => {
    if (event.buttons === 0) hardStopCameraGesture();
  }, false);

  let tileset = null;
  let mode = 'none'; // none | distance | area | addNote
  let pendingPoint = null;
  let areaPoints = [];
  let notesVisible = true;
  let noteEntities = [];
  const measurementEntities = [];

  function requestRender() { viewer.scene.requestRender(); }
  function setLoadState(text, type = '') {
    loadState.textContent = text;
    loadState.className = `load-state ${type}`.trim();
    requestRender();
  }
  function setHint(text = '', target = measureHint) {
    target.hidden = !text;
    target.textContent = text;
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return '—';
    if (meters < 1) return `${(meters * 100).toFixed(1)} cm`;
    if (meters < 10) return `${meters.toFixed(3)} m`;
    if (meters < 1000) return `${meters.toFixed(2)} m`;
    return `${(meters / 1000).toFixed(3)} km`;
  }

  function formatArea(squareMeters) {
    if (!Number.isFinite(squareMeters)) return '—';
    if (squareMeters < 1) return `${(squareMeters * 10000).toFixed(1)} cm²`;
    if (squareMeters < 10000) return `${squareMeters.toFixed(2)} m²`;
    return `${(squareMeters / 10000).toFixed(3)} дка`;
  }

  function clearMeasurements() {
    measurementEntities.splice(0).forEach((entity) => viewer.entities.remove(entity));
    pendingPoint = null;
    areaPoints = [];
    if (mode === 'distance') setHint('Избери първа точка', measureHint);
    else if (mode === 'area') setHint('Избери първа точка от контура', measureHint);
    requestRender();
  }

  function deactivateModes() {
    mode = 'none';
    pendingPoint = null;
    areaPoints = [];
    measureBtn.classList.remove('active');
    areaBtn.classList.remove('active');
    addNoteBtn.classList.remove('active');
    measureBtn.setAttribute('aria-pressed', 'false');
    areaBtn.setAttribute('aria-pressed', 'false');
    addNoteBtn.setAttribute('aria-pressed', 'false');
    setHint('', measureHint);
    notesHint.textContent = 'Кликни „Добави бележка“ и после върху модела.';
    requestRender();
  }

  function activateMode(nextMode) {
    clearMeasurements();
    deactivateModes();
    mode = nextMode;
    if (mode === 'distance') {
      measureBtn.classList.add('active');
      measureBtn.setAttribute('aria-pressed', 'true');
      setHint('Избери първа точка', measureHint);
    } else if (mode === 'area') {
      areaBtn.classList.add('active');
      areaBtn.setAttribute('aria-pressed', 'true');
      setHint('Избери първа точка от контура', measureHint);
    } else if (mode === 'addNote') {
      addNoteBtn.classList.add('active');
      addNoteBtn.setAttribute('aria-pressed', 'true');
      notesHint.textContent = 'Щракни върху модела, за да поставиш бележка.';
    }
    requestRender();
  }

  function addPointGraphic(position) {
    const entity = viewer.entities.add({
      position,
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString('#ffd54a'),
        outlineColor: Cesium.Color.fromCssColorString('#111318'),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    measurementEntities.push(entity);
    return entity;
  }

  function addLabel(position, text) {
    const entity = viewer.entities.add({
      position,
      label: {
        text,
        font: '600 15px Inter, Arial, sans-serif',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#111318').withAlpha(0.88),
        backgroundPadding: new Cesium.Cartesian2(8, 5),
        pixelOffset: new Cesium.Cartesian2(0, -18),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    measurementEntities.push(entity);
    return entity;
  }

  function addDistanceMeasurement(a, b) {
    const midpoint = Cesium.Cartesian3.midpoint(a, b, new Cesium.Cartesian3());
    const distance = Cesium.Cartesian3.distance(a, b);
    const line = viewer.entities.add({
      polyline: {
        positions: [a, b],
        width: 4,
        material: Cesium.Color.fromCssColorString('#ffd54a'),
        depthFailMaterial: Cesium.Color.fromCssColorString('#ffd54a').withAlpha(0.45)
      }
    });
    measurementEntities.push(line);
    addLabel(midpoint, formatDistance(distance));
    setHint(`Измерено: ${formatDistance(distance)} · избери нова първа точка`, measureHint);
  }

  function cartesianToLocal2D(center, positions) {
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    const inverse = Cesium.Matrix4.inverseTransformation(transform, new Cesium.Matrix4());
    return positions.map((pos) => {
      const local = Cesium.Matrix4.multiplyByPoint(inverse, pos, new Cesium.Cartesian3());
      return { x: local.x, y: local.y };
    });
  }

  function polygonArea2D(points) {
    let area = 0;
    for (let i = 0; i < points.length; i += 1) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    return Math.abs(area) * 0.5;
  }

  function finalizeAreaMeasurement() {
    if (areaPoints.length < 3) {
      setHint('За площ трябват поне 3 точки', measureHint);
      return;
    }

    const polygon = viewer.entities.add({
      polygon: {
        hierarchy: areaPoints.slice(),
        material: Cesium.Color.fromCssColorString('#ffd54a').withAlpha(0.22),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#ffd54a'),
        perPositionHeight: true
      }
    });
    measurementEntities.push(polygon);

    const center = Cesium.BoundingSphere.fromPoints(areaPoints).center;
    const localPoints = cartesianToLocal2D(center, areaPoints);
    const area = polygonArea2D(localPoints);
    addLabel(center, formatArea(area));
    setHint(`Площ: ${formatArea(area)} · избери нов контур`, measureHint);
    areaPoints = [];
    requestRender();
  }

  function updateDetail(level) {
    if (!tileset) return;
    const settings = {
      standard: { error: isMobile ? 5 : 2.5, memory: isMobile ? 384 : 1024 },
      high: { error: isMobile ? 3 : 1.25, memory: isMobile ? 512 : 1536 },
      max: { error: isMobile ? 1.5 : 0.5, memory: isMobile ? 768 : 2048 }
    };
    const selected = settings[level] || settings.standard;
    tileset.maximumScreenSpaceError = selected.error;
    tileset.maximumMemoryUsage = selected.memory;
    detailSegment.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.detail === level);
    });
    requestRender();
  }

  // Stable model-centred views using absolute ECEF camera coordinates.
  // No lookAtTransform(), no tracked entity, no camera flight and no camera tween.
  function stopAutomaticCameraMotion() {
    viewer.camera.cancelFlight();
    viewer.trackedEntity = undefined;
    viewer.clock.shouldAnimate = false;
    viewer.scene.tweens.removeAll();
  }

  function scaled(v, k) {
    return Cesium.Cartesian3.multiplyByScalar(v, k, new Cesium.Cartesian3());
  }

  function added(a, b) {
    return Cesium.Cartesian3.add(a, b, new Cesium.Cartesian3());
  }

  function setCameraFromOffset(center, offset, upHint) {
    stopAutomaticCameraMotion();

    const destination = added(center, offset);
    const direction = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.subtract(center, destination, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );

    // Make sure the supplied up vector is perpendicular to the viewing direction.
    const right = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.cross(direction, upHint, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    const cameraUp = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );

    viewer.camera.setView({
      destination,
      orientation: {
        direction,
        up: cameraUp
      }
    });

    stopAutomaticCameraMotion();
    requestRender();
  }

  function setDirectionalView(kind) {
    if (!tileset) return;

    const sphere = tileset.boundingSphere;
    const center = Cesium.Cartesian3.clone(sphere.center);
    const distance = Math.max(sphere.radius * 2.65, 10);

    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    const rotation = Cesium.Matrix4.getMatrix3(enu, new Cesium.Matrix3());
    const east = Cesium.Matrix3.getColumn(rotation, 0, new Cesium.Cartesian3());
    const north = Cesium.Matrix3.getColumn(rotation, 1, new Cesium.Cartesian3());
    const up = Cesium.Matrix3.getColumn(rotation, 2, new Cesium.Cartesian3());

    if (kind === 'top') {
      setCameraFromOffset(center, scaled(up, distance), north);
      return;
    }

    if (kind === 'front') {
      setCameraFromOffset(center, scaled(north, distance), up);
      return;
    }

    if (kind === 'back') {
      setCameraFromOffset(center, scaled(north, -distance), up);
      return;
    }

    if (kind === 'left') {
      setCameraFromOffset(center, scaled(east, -distance), up);
      return;
    }

    if (kind === 'right') {
      setCameraFromOffset(center, scaled(east, distance), up);
      return;
    }

    // Home: oblique 3/4 view.
    const horizontal = added(scaled(east, distance * 0.70), scaled(north, distance * 0.70));
    const homeOffset = added(horizontal, scaled(up, distance * 0.52));
    setCameraFromOffset(center, homeOffset, up);
  }

  function getStoredNotes() {
    try {
      return JSON.parse(localStorage.getItem(NOTES_STORAGE_KEY) || '[]');
    } catch (_) {
      return [];
    }
  }

  function saveStoredNotes(notes) {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
  }

  function clearRenderedNotes() {
    noteEntities.forEach((entity) => viewer.entities.remove(entity));
    noteEntities = [];
  }

  function renderNotes() {
    clearRenderedNotes();
    const notes = getStoredNotes();
    notes.forEach((note) => {
      const position = Cesium.Cartesian3.fromDegrees(note.lon, note.lat, note.height || 0);
      const point = viewer.entities.add({
        position,
        point: {
          pixelSize: 13,
          color: Cesium.Color.fromCssColorString('#5dc5ff'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          show: notesVisible,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: note.title,
          font: '700 14px Inter, Arial, sans-serif',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#0f1825').withAlpha(0.92),
          backgroundPadding: new Cesium.Cartesian2(8, 5),
          pixelOffset: new Cesium.Cartesian2(0, -24),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          show: notesVisible,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        description: `<div style="padding:8px;font-family:Inter,Arial,sans-serif;"><strong>${note.title}</strong><br>${note.text || ''}</div>`
      });
      noteEntities.push(point);
    });
    requestRender();
  }

  function exportNotes() {
    const blob = new Blob([JSON.stringify(getStoredNotes(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
   a.download = 'block54-notes.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importNotes(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('invalid');
        saveStoredNotes(data);
        renderNotes();
        notesHint.textContent = 'Бележките са импортирани.';
      } catch (_) {
        notesHint.textContent = 'Невалиден JSON файл за бележки.';
      }
    };
    reader.readAsText(file);
  }

  async function loadTileset() {
    try {
      setLoadState('Зареждане на модела…');

      tileset = await Cesium.Cesium3DTileset.fromUrl('./tileset.json', {
        maximumScreenSpaceError: isMobile ? 5 : 2.5,
        skipLevelOfDetail: false,
        preferLeaves: true,
        dynamicScreenSpaceError: false,
        foveatedScreenSpaceError: false,
        cullRequestsWhileMoving: false,
        cullWithChildrenBounds: false,
        preloadWhenHidden: false,
        preloadFlightDestinations: true
      });

      viewer.scene.primitives.add(tileset);
      tileset.maximumMemoryUsage = isMobile ? 384 : 1024;
      setDirectionalView('home');
      setLoadState('Моделът е готов · HARD-LOCK v4', 'ok');
      renderNotes();
      requestRender();
    } catch (error) {
      console.error(error);
      setLoadState('Грешка при зареждане', 'error');
      setHint('Моделът не може да се зареди. Провери дали tileset.json и всички папки са качени.', measureHint);
      requestRender();
    }
  }

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement) => {
    if (mode === 'none') return;

    let position;
    try {
      position = viewer.scene.pickPosition(movement.position);
    } catch (error) {
      console.warn('pickPosition failed', error);
      return;
    }
    if (!Cesium.defined(position)) {
      if (mode === 'addNote') notesHint.textContent = 'Щракни директно върху повърхността на модела.';
      else setHint('Щракни директно върху повърхността на модела', measureHint);
      requestRender();
      return;
    }

    if (mode === 'distance') {
      addPointGraphic(position);
      if (!pendingPoint) {
        pendingPoint = Cesium.Cartesian3.clone(position);
        setHint('Избери втора точка', measureHint);
      } else {
        addDistanceMeasurement(pendingPoint, position);
        pendingPoint = null;
      }
      requestRender();
      return;
    }

    if (mode === 'area') {
      areaPoints.push(Cesium.Cartesian3.clone(position));
      addPointGraphic(position);
      if (areaPoints.length > 1) {
        const prev = areaPoints[areaPoints.length - 2];
        const segment = viewer.entities.add({
          polyline: {
            positions: [prev, position],
            width: 3,
            material: Cesium.Color.fromCssColorString('#ffd54a')
          }
        });
        measurementEntities.push(segment);
      }
      setHint(`Точки: ${areaPoints.length} · десен бутон завършва контура`, measureHint);
      requestRender();
      return;
    }

    if (mode === 'addNote') {
      const cartographic = Cesium.Cartographic.fromCartesian(position);
      const title = window.prompt('Заглавие на бележката:');
      if (!title) return;
      const text = window.prompt('Описание / бележка:') || '';
      const notes = getStoredNotes();
      notes.push({
        title,
        text,
        lon: Cesium.Math.toDegrees(cartographic.longitude),
        lat: Cesium.Math.toDegrees(cartographic.latitude),
        height: cartographic.height
      });
      saveStoredNotes(notes);
      renderNotes();
      notesHint.textContent = `Добавена бележка: ${title}`;
      deactivateModes();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction(() => {
    if (mode === 'area' && areaPoints.length >= 3) {
      const first = areaPoints[0];
      const last = areaPoints[areaPoints.length - 1];
      const closing = viewer.entities.add({
        polyline: {
          positions: [last, first],
          width: 3,
          material: Cesium.Color.fromCssColorString('#ffd54a')
        }
      });
      measurementEntities.push(closing);
      finalizeAreaMeasurement();
    }
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  measureBtn.addEventListener('click', () => activateMode(mode === 'distance' ? 'none' : 'distance'));
  areaBtn.addEventListener('click', () => activateMode(mode === 'area' ? 'none' : 'area'));
  addNoteBtn.addEventListener('click', () => activateMode(mode === 'addNote' ? 'none' : 'addNote'));
  clearBtn.addEventListener('click', clearMeasurements);
  fullscreenBtn.addEventListener('click', async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  });

  viewBtns.home.addEventListener('click', () => setDirectionalView('home'));
  viewBtns.top.addEventListener('click', () => setDirectionalView('top'));
  viewBtns.front.addEventListener('click', () => setDirectionalView('front'));
  viewBtns.back.addEventListener('click', () => setDirectionalView('back'));
  viewBtns.left.addEventListener('click', () => setDirectionalView('left'));
  viewBtns.right.addEventListener('click', () => setDirectionalView('right'));

  toggleNotesBtn.addEventListener('click', () => {
    notesVisible = !notesVisible;
    noteEntities.forEach((entity) => {
      if (entity.point) entity.point.show = notesVisible;
      if (entity.label) entity.label.show = notesVisible;
    });
    toggleNotesBtn.textContent = notesVisible ? 'Скрий бележки' : 'Покажи бележки';
    toggleNotesBtn.setAttribute('aria-pressed', String(notesVisible));
    requestRender();
  });
  exportNotesBtn.addEventListener('click', exportNotes);
  importNotesInput.addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) importNotes(file);
    event.target.value = '';
  });

  detailSegment.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => updateDetail(btn.dataset.detail));
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') deactivateModes();
  });

  console.info('[Block54 viewer] HARD-LOCK v4 loaded');
  loadTileset();
})();
