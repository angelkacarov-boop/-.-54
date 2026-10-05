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
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 0.2;

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

  function getViewTransformData() {
    const sphere = tileset.boundingSphere;
    const center = sphere.center;
    const radius = sphere.radius;
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    const east = Cesium.Matrix4.getColumn(transform, 0, new Cesium.Cartesian4());
    const north = Cesium.Matrix4.getColumn(transform, 1, new Cesium.Cartesian4());
    const up = Cesium.Matrix4.getColumn(transform, 2, new Cesium.Cartesian4());
    const E = new Cesium.Cartesian3(east.x, east.y, east.z);
    const N = new Cesium.Cartesian3(north.x, north.y, north.z);
    const U = new Cesium.Cartesian3(up.x, up.y, up.z);
    return { center, radius, E, N, U };
  }

  function setDirectionalView(kind) {
  if (!tileset) return;

  const headings = {
    top: 0,
    front: 0,
    back: 180,
    left: 90,
    right: 270
  };

  viewer.camera.cancelFlight();

  viewer.camera.viewBoundingSphere(
    tileset.boundingSphere,
    new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(headings[kind] ?? 0),
      Cesium.Math.toRadians(kind === 'top' ? -90 : -10),
      0
    )
  );

  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.scene.requestRender();
}

    if (kind === 'top') {
      destination = Cesium.Cartesian3.add(center, Cesium.Cartesian3.multiplyByScalar(U, top, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      orientation = { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 };
    } else if (kind === 'front') {
      destination = Cesium.Cartesian3.add(center,
        Cesium.Cartesian3.add(Cesium.Cartesian3.multiplyByScalar(N, -side, new Cesium.Cartesian3()), Cesium.Cartesian3.multiplyByScalar(U, radius * 0.45, new Cesium.Cartesian3()), new Cesium.Cartesian3()),
        new Cesium.Cartesian3());
      orientation = { direction: Cesium.Cartesian3.subtract(center, destination, new Cesium.Cartesian3()), up: U };
    } else if (kind === 'back') {
      destination = Cesium.Cartesian3.add(center,
        Cesium.Cartesian3.add(Cesium.Cartesian3.multiplyByScalar(N, side, new Cesium.Cartesian3()), Cesium.Cartesian3.multiplyByScalar(U, radius * 0.45, new Cesium.Cartesian3()), new Cesium.Cartesian3()),
        new Cesium.Cartesian3());
      orientation = { direction: Cesium.Cartesian3.subtract(center, destination, new Cesium.Cartesian3()), up: U };
    } else if (kind === 'left') {
      destination = Cesium.Cartesian3.add(center,
        Cesium.Cartesian3.add(Cesium.Cartesian3.multiplyByScalar(E, -side, new Cesium.Cartesian3()), Cesium.Cartesian3.multiplyByScalar(U, radius * 0.35, new Cesium.Cartesian3()), new Cesium.Cartesian3()),
        new Cesium.Cartesian3());
      orientation = { direction: Cesium.Cartesian3.subtract(center, destination, new Cesium.Cartesian3()), up: U };
    } else if (kind === 'right') {
      destination = Cesium.Cartesian3.add(center,
        Cesium.Cartesian3.add(Cesium.Cartesian3.multiplyByScalar(E, side, new Cesium.Cartesian3()), Cesium.Cartesian3.multiplyByScalar(U, radius * 0.35, new Cesium.Cartesian3()), new Cesium.Cartesian3()),
        new Cesium.Cartesian3());
      orientation = { direction: Cesium.Cartesian3.subtract(center, destination, new Cesium.Cartesian3()), up: U };
    }

    viewer.camera.flyTo({ destination, orientation, duration: 0.9 });
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
      await viewer.zoomTo(tileset);
      viewer.camera.lookUp(Cesium.Math.toRadians(6));
      setLoadState('Моделът е готов', 'ok');
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

  viewBtns.home.addEventListener('click', async () => { if (tileset) await viewer.zoomTo(tileset); requestRender(); });
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

  viewer.camera.moveStart.addEventListener(requestRender);
  viewer.camera.changed.addEventListener(requestRender);
  viewer.camera.moveEnd.addEventListener(requestRender);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') deactivateModes();
  });

  loadTileset();
})();
