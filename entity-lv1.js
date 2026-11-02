// entity-lv1.js — Dashboard Entity: the hardcoded, built-in LV1 pack.
// Included directly in Lavender (index.html), needs no import and no purchase, and is never written to
// settings.entityPacks. It is a normal pack manifest in the SAME declarative format imported packs use
// (entity-lvpack-data.js spec v1) and is validated by the SAME validate() when it registers, so the
// built-in and imported packs share one runtime interface.
//
// FOUNDATION PHASE: this manifest is an intentionally empty scene (one fully transparent pixel layer and
// one invisible placeholder entity), because the spec requires at least one environment, entity, behavior,
// animation and frame. The pond environment replaces the `pond` environment's layers in the next phase;
// the frog and ambient elements are added later as further entities/behaviors. Nothing here draws anything.
//
// Load order: entity-lvpack-data.js -> entity-lv1.js -> entity-renderer.js
const EntityLV1 = (function () {
  'use strict';

  const manifest = {
    format: 'lv-pack',
    category: 'dashboard-entity',
    manifestVersion: 1,
    engineVersion: 1,
    id: 'entity.lv1',
    name: 'LV1',
    version: '1.0.0',
    author: 'Lavender',
    description: 'Lavender\u2019s built-in Dashboard Entity.',
    palettes: { base: { a: '#000000' } },
    frames: { blank: { size: { w: 1, h: 1 }, palette: 'base', rows: ['.'] } },
    animations: { still: { frames: ['blank'], frameMs: 1000, loop: true } },
    behaviors: { idle: { type: 'loop', animation: 'still' } },
    entities: [{ id: 'placeholder', type: 'pixel-sprite', name: 'Placeholder', animations: ['still'], lifecycle: { onEnter: 'idle' } }],
    environments: [{ id: 'pond', type: 'pixel-scene', name: 'Pond', size: { w: 192, h: 108 }, layers: [{ frame: 'blank', x: 0, y: 0 }] }],
    entry: { environment: 'pond', entity: 'placeholder' }
  };

  let registered = false;
  if (typeof EntityLVPackData !== 'undefined' && EntityLVPackData && typeof EntityLVPackData.registerBuiltin === 'function') {
    const r = EntityLVPackData.registerBuiltin(manifest);
    registered = !!(r && r.ok);
    if (!registered && typeof console !== 'undefined') console.error('[EntityLV1] could not register the built-in pack:', r && r.errors);
  } else if (typeof console !== 'undefined') {
    console.error('[EntityLV1] EntityLVPackData is not available; the built-in pack was not registered.');
  }

  return { id: manifest.id, isRegistered: function () { return registered; } };
})();
