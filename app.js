(() => {
  'use strict';

  const loadState = document.getElementById('loadState');
  const measureBtn = document.getElementById('measureBtn');
  const clearBtn = document.getElementById('clearBtn');
  const homeBtn = document.getElementById('homeBtn');
  const measureHint = document.getElementById('measureHint');
  const container = document.getElementById('cesiumContainer');

  const isMobile = window.matchMedia('(max-width: 720px)').matches;

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
    shouldAnimate: false
  });

  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#101216');
  viewer.scene.skyBox.show = false;
  viewer.scene.skyAtmosphere.show = false;
  viewer.scene.sun.show = false;
  viewer.scene.moon.show = false;
  viewer.scene.fog.enabled = false;
  viewer.scene.pickTranslucentDepth = true;
  viewer.scene.postProcessStages.fxaa.enabled = true;

  let tileset = null;
  let measuring = false;
  let pendingPoint = null;
  const measurementEntities = [];

  function setLoadState(text, type = '') {
    loadState.textContent = text;
    loadState.className = `load-state ${type}`.trim();
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return '—';
    if (meters < 1) return `${(meters * 100).toFixed(1)} cm`;
    if (meters < 10) return `${meters.toFixed(3)} m`;
    if (meters < 1000) return `${meters.toFixed(2)} m`;
    return `${(meters / 1000).toFixed(3)} km`;
  }

  function addMeasurementPoint(position) {
    const entity = viewer.entities.add({
      position,
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString('#ffd54a'),
        outlineColor: Cesium.Color.fromCssColorString('#111318'),
        outlineWidth: 2
      }
    });
    measurementEntities.push(entity);
    return entity;
  }

  function addMeasurementLine(a, b, distance) {
    const midpoint = Cesium.Cartesian3.midpoint(a, b, new Cesium.Cartesian3());

    const line = viewer.entities.add({
      polyline: {
        positions: [a, b],
        width: 4,
        material: Cesium.Color.fromCssColorString('#ffd54a'),
        depthFailMaterial: Cesium.Color.fromCssColorString('#ffd54a').withAlpha(0.45)
      }
    });

    const label = viewer.entities.add({
      position: midpoint,
      label: {
        text: formatDistance(distance),
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

    measurementEntities.push(line, label);
  }

  function clearMeasurements() {
    measurementEntities.splice(0).forEach((entity) => viewer.entities.remove(entity));
    pendingPoint = null;
    if (measuring) {
      measureHint.textContent = 'Избери първа точка върху модела';
    }
  }

  function setMeasuring(next) {
    measuring = next;
    pendingPoint = null;
    measureBtn.classList.toggle('active', measuring);
    measureBtn.setAttribute('aria-pressed', measuring ? 'true' : 'false');
    measureHint.hidden = !measuring;
    container.classList.toggle('measuring', measuring);
    if (measuring) {
      measureHint.textContent = 'Избери първа точка върху модела';
    }
  }

  async function loadTileset() {
    try {
      setLoadState('Зареждане на модела…');

      tileset = await Cesium.Cesium3DTileset.fromUrl('./tileset.json', {
        // По-ниска стойност = повече детайл от по-далеч.
        maximumScreenSpaceError: isMobile ? 6 : 2,
        skipLevelOfDetail: false,
        preferLeaves: true,
        dynamicScreenSpaceError: false,
        preloadWhenHidden: false
      });

      viewer.scene.primitives.add(tileset);
      await viewer.zoomTo(tileset);
      setLoadState('Моделът е готов · BASELINE', 'ok');

      viewer.camera.lookUp(Cesium.Math.toRadians(6));
    } catch (error) {
      console.error(error);
      setLoadState('Грешка при зареждане', 'error');
      measureHint.hidden = false;
      measureHint.textContent = 'Моделът не може да се зареди. Провери дали сайтът е качен с всички папки.';
    }
  }

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement) => {
    if (!measuring) return;

    let position;
    try {
      position = viewer.scene.pickPosition(movement.position);
    } catch (error) {
      console.warn('pickPosition failed', error);
      return;
    }

    if (!Cesium.defined(position)) {
      measureHint.textContent = 'Щракни директно върху повърхност от модела';
      return;
    }

    addMeasurementPoint(position);

    if (!pendingPoint) {
      pendingPoint = Cesium.Cartesian3.clone(position);
      measureHint.textContent = 'Избери втора точка';
      return;
    }

    const distance = Cesium.Cartesian3.distance(pendingPoint, position);
    addMeasurementLine(pendingPoint, position, distance);
    pendingPoint = null;
    measureHint.textContent = `Измерено: ${formatDistance(distance)} · избери нова първа точка`;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  measureBtn.addEventListener('click', () => setMeasuring(!measuring));
  clearBtn.addEventListener('click', clearMeasurements);
  homeBtn.addEventListener('click', async () => {
    if (tileset) await viewer.zoomTo(tileset);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMeasuring(false);
    if (event.key.toLowerCase() === 'm') setMeasuring(!measuring);
  });

  loadTileset();
})();
