/**
 * metatab.js — "Metadata" tab: per-project presets, per-group field values,
 * and what the export needs (CoralNet CSV rows, file names, EXIF to embed).
 *
 * Photos are grouped by their source folder (Drive subfolder, zip folder or
 * a folder dropped from Finder/Explorer); every photo of a group gets the
 * group's values. Values can be pre-filled from the folder names (see
 * folderGuess) and are remembered in this browser for the next session.
 *
 * Presets describe the CSV the destination expects. The first one is the
 * MBON Pole to Pole intertidal / CoralNet layout:
 *   Name, Date, <5 Aux: country, state, locality, site, strata>, Height (cm),
 *   Latitude, Longitude, Depth, Camera, Photographer, Water quality, Strobes,
 *   Framing gear used, White balance card, Comments
 */
(function (root) {
  'use strict';

  var STRATA = ['HIGHTIDE', 'MIDTIDE', 'LOWTIDE'];

  var PRESETS = {
    intertidal: {
      label: 'Intertidal — MBON Pole to Pole (CoralNet)',
      csvName: 'metadata_coralnet.csv',
      columns: ['Name', 'Date', 'country', 'state', 'locality', 'site', 'strata', 'Height (cm)',
        'Latitude', 'Longitude', 'Depth', 'Camera', 'Photographer', 'Water quality', 'Strobes',
        'Framing gear used', 'White balance card', 'Comments'],
      // read from each photo
      auto: { Name: 'file name of the crop', Date: 'EXIF date', Latitude: 'EXIF GPS',
              Longitude: 'EXIF GPS', Camera: 'EXIF camera model' },
      // same for every photo of the project
      fixed: { 'Height (cm)': '42', Strobes: 'no', 'Framing gear used': '25x25cm' },
      // filled per group (folder); upper: stored upper-case like the P2P data
      fields: [
        { key: 'country', upper: true, required: true },
        { key: 'state', upper: true, required: true },
        { key: 'locality', upper: true, required: true },
        { key: 'site', upper: true, required: true },
        { key: 'strata', options: STRATA, required: true },
        { key: 'Photographer', required: true },
        { key: 'Comments', hint: 'e.g. AMP12' },
        { key: 'Depth' },
        { key: 'Water quality' },
        { key: 'White balance card' }
      ]
    }
  };

  var LS = 'quadrat.meta.v1';
  var st = {
    preset: 'intertidal',   // or 'none'
    nameFormat: 'source',   // 'source' | 'dateprefix'
    groups: {},             // groupKey -> { field: value }
    last: {}                // last value typed per field (default for new groups)
  };
  var ui = {}, getItems = function () { return []; };

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(LS) || '{}');
      if (s.preset) st.preset = s.preset;
      if (s.nameFormat) st.nameFormat = s.nameFormat;
      st.last = s.last || {};
    } catch (e) { /* private mode */ }
  }
  function save() {
    try { localStorage.setItem(LS, JSON.stringify({ preset: st.preset, nameFormat: st.nameFormat, last: st.last })); } catch (e) { /* private mode */ }
  }

  function preset() { return PRESETS[st.preset] || null; }

  // ------------------------------------------------------------- groups

  /** Group key of a photo: its source folder, or the load it came with. */
  function groupOf(it) { return it.group || 'Ungrouped'; }

  function groupList() {
    var map = {}, order = [];
    getItems().forEach(function (it) {
      var g = groupOf(it);
      if (!map[g]) { map[g] = { key: g, n: 0, nExport: 0 }; order.push(g); }
      map[g].n++;
    });
    return order.map(function (k) { return map[k]; });
  }

  function normStrata(v) {
    var s = String(v || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!s) return '';
    if (/HIGH|ALT[OA]|SUPERIOR|SUP/.test(s)) return 'HIGHTIDE';
    if (/MID|MEDI[OA]|MEIO/.test(s)) return 'MIDTIDE';
    if (/LOW|BAJ[OA]|INFERIOR|INF|BAIX/.test(s)) return 'LOWTIDE';
    return '';
  }

  /**
   * Guess fields from the folder path (deepest folder first): a level that
   * reads as a tide level fills `strata`, the levels above it fill site,
   * locality and state. Only empty fields are filled; the user can edit.
   * (Tuned to the field team's Drive layout once we have a real example.)
   */
  function folderGuess(groupKey) {
    var parts = String(groupKey).split('/').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length || groupKey === 'Ungrouped' || /^Load \d+$/.test(groupKey)) return {};
    var out = {}, i = parts.length - 1;
    var sv = normStrata(parts[i]);
    if (sv) { out.strata = sv; i--; }
    ['site', 'locality', 'state'].forEach(function (k) {
      if (i >= 0) { out[k] = parts[i].toUpperCase(); i--; }
    });
    return out;
  }

  function valuesFor(groupKey) {
    if (!st.groups[groupKey]) {
      var v = {}, p = preset();
      if (p) {
        var guess = folderGuess(groupKey);
        p.fields.forEach(function (f) {
          v[f.key] = guess[f.key] || (f.key === 'country' || f.key === 'Photographer' ? (st.last[f.key] || '') : '');
        });
      }
      st.groups[groupKey] = v;
    }
    return st.groups[groupKey];
  }

  // ------------------------------------------------------------- export API

  function exifDate(it) {
    var d = it.exif && (it.exif.dateTimeOriginal || it.exif.modifyDate);
    if (d && /^\d{4}:\d{2}:\d{2}/.test(d)) return d;
    if (it.meta && it.meta.date) return it.meta.date.replace(/-/g, ':') + ' 00:00:00';
    return '';
  }

  /** Output file name (CoralNet "Name"): the source name as .jpg, optionally date-prefixed. */
  function nameFor(it) {
    var base = it.name.replace(/\.[^.]+$/, '');
    if (st.nameFormat === 'dateprefix' && !/^\d{8}[_-]/.test(base)) {
      var d = exifDate(it);
      if (d) base = d.slice(0, 10).replace(/:/g, '') + '_' + base;
    }
    return base + '.jpg';
  }

  function rowFor(it, name) {
    var p = preset(); if (!p) return null;
    var g = valuesFor(groupOf(it)), d = exifDate(it);
    var vals = {
      Name: name,
      Date: d ? d.slice(0, 10).replace(/:/g, '-') : '',
      // 8 decimals ≈ 1 mm: drops float noise like -54.858760000000004
      Latitude: it.exif && it.exif.latitude != null ? String(+it.exif.latitude.toFixed(8)) : '',
      Longitude: it.exif && it.exif.longitude != null ? String(+it.exif.longitude.toFixed(8)) : '',
      Camera: (it.exif && it.exif.model) || ''
    };
    Object.keys(p.fixed).forEach(function (k) { vals[k] = p.fixed[k]; });
    p.fields.forEach(function (f) { vals[f.key] = g[f.key] || ''; });
    return p.columns.map(function (c) { return vals[c] != null ? vals[c] : ''; });
  }

  /** EXIF block for one crop: camera date/GPS/model + this group's fields. */
  function exifFor(it) {
    var p = preset(), g = p ? valuesFor(groupOf(it)) : {};
    var desc = [];
    if (p) {
      p.fields.forEach(function (f) { if (g[f.key]) desc.push(f.key + '=' + g[f.key]); });
      Object.keys(p.fixed).forEach(function (k) { desc.push(k + '=' + p.fixed[k]); });
    }
    return {
      make: it.exif && it.exif.make, model: it.exif && it.exif.model,
      dateTimeOriginal: exifDate(it),
      latitude: it.exif ? it.exif.latitude : null, longitude: it.exif ? it.exif.longitude : null,
      artist: g.Photographer || '', description: desc.join('; ')
    };
  }

  /** Groups (among the exported photos) with required fields still empty. */
  function missing(items) {
    var p = preset(); if (!p) return [];
    var seen = {}, out = [];
    items.forEach(function (it) {
      var k = groupOf(it); if (seen[k]) return; seen[k] = true;
      var v = valuesFor(k);
      var miss = p.fields.filter(function (f) { return f.required && !v[f.key]; }).map(function (f) { return f.key; });
      if (miss.length) out.push(k + ': ' + miss.join(', '));
    });
    return out;
  }

  function exportInfo() {
    var p = preset();
    if (!p) return null;
    return { csvName: p.csvName, columns: p.columns, nameFor: nameFor, rowFor: rowFor, exifFor: exifFor, missing: missing };
  }

  // ------------------------------------------------------------- UI

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function render() {
    if (!ui.panel) return;
    var p = preset(), groups = groupList();
    ui.presetSel.value = st.preset;
    ui.nameSel.value = st.nameFormat;
    if (!p) { ui.body.innerHTML = '<p class="muted">No metadata file will be added to the ZIP.</p>'; return; }
    var html = '<div class="meta-fixed">'
      + '<span class="muted">From each photo:</span> ' + Object.keys(p.auto).map(function (k) { return '<code>' + esc(k) + '</code>'; }).join(' ')
      + ' &nbsp; <span class="muted">Same for all:</span> ' + Object.keys(p.fixed).map(function (k) { return '<code>' + esc(k) + ' = ' + esc(p.fixed[k]) + '</code>'; }).join(' ')
      + '</div>';
    if (!groups.length) {
      ui.body.innerHTML = html + '<p class="muted">Load photos first: each source folder becomes a group here.</p>';
      return;
    }
    html += '<div class="meta-scroll"><table class="meta-table"><thead><tr><th>Folder / group</th><th>#</th>';
    p.fields.forEach(function (f) {
      html += '<th>' + esc(f.key) + (f.required ? ' <span class="req">*</span>' : '')
        + (groups.length > 1 ? '<button type="button" class="filldown" data-k="' + esc(f.key) + '" title="Copy the first group\'s value to every empty cell in this column">⇣</button>' : '')
        + '</th>';
    });
    html += '</tr></thead><tbody>';
    groups.forEach(function (g) {
      var v = valuesFor(g.key);
      // the deepest folders are what tells groups apart: show the path's tail
      var parts = g.key.split('/'), shown = parts.length > 3 ? '…/' + parts.slice(-3).join('/') : g.key;
      html += '<tr><td class="gname" title="' + esc(g.key) + '">' + esc(shown) + '</td><td>' + g.n + '</td>';
      p.fields.forEach(function (f) {
        var val = v[f.key] || '', cls = (f.required && !val) ? ' class="missing"' : '';
        if (f.options) {
          html += '<td><select data-g="' + esc(g.key) + '" data-k="' + esc(f.key) + '"' + cls + '><option value=""></option>'
            + f.options.map(function (o) { return '<option' + (o === val ? ' selected' : '') + '>' + o + '</option>'; }).join('')
            + '</select></td>';
        } else {
          html += '<td><input type="text" data-g="' + esc(g.key) + '" data-k="' + esc(f.key) + '" value="' + esc(val) + '"'
            + (f.hint ? ' placeholder="' + esc(f.hint) + '"' : '') + cls + '></td>';
        }
      });
      html += '</tr>';
    });
    html += '</tbody></table></div><p class="muted small"><span class="req">*</span> required for CoralNet. '
      + 'The ZIP gets <code>' + esc(p.csvName) + '</code> (upload it to CoralNet with the crops) and every crop carries '
      + 'these values plus date, GPS and camera in its EXIF.</p>';
    ui.body.innerHTML = html;
  }

  function onInput(e) {
    var t = e.target, g = t.getAttribute('data-g'), k = t.getAttribute('data-k');
    if (!g || !k) return;
    var f = preset().fields.filter(function (x) { return x.key === k; })[0];
    var v = t.value;
    if (f && f.upper) { v = v.toUpperCase(); if (t.value !== v) { var pos = t.selectionStart; t.value = v; try { t.setSelectionRange(pos, pos); } catch (er) { /* select */ } } }
    valuesFor(g)[k] = v.trim();
    st.last[k] = v.trim();
    save();
    t.classList.toggle('missing', !!(f && f.required && !v.trim()));
    if (ui.onChange) ui.onChange();
  }

  function fillDown(k) {
    var groups = groupList(); if (!groups.length) return;
    var first = valuesFor(groups[0].key)[k];
    if (!first) return;
    groups.forEach(function (g) { var v = valuesFor(g.key); if (!v[k]) v[k] = first; });
    render();
  }

  function init(opts) {
    load();
    getItems = opts.getItems;
    ui.onChange = opts.onChange;
    ui.panel = document.getElementById('metaPanel');
    ui.body = document.getElementById('metaBody');
    ui.presetSel = document.getElementById('metaPreset');
    ui.nameSel = document.getElementById('metaNameFormat');
    ui.presetSel.innerHTML = Object.keys(PRESETS).map(function (k) { return '<option value="' + k + '">' + esc(PRESETS[k].label) + '</option>'; }).join('')
      + '<option value="none">None — no metadata file</option>';
    ui.presetSel.addEventListener('change', function () { st.preset = ui.presetSel.value; st.groups = {}; save(); render(); });
    ui.nameSel.addEventListener('change', function () { st.nameFormat = ui.nameSel.value; save(); });
    ui.body.addEventListener('input', onInput);
    ui.body.addEventListener('change', onInput);
    ui.body.addEventListener('click', function (e) {
      var k = e.target.getAttribute && e.target.getAttribute('data-k');
      if (k && e.target.classList.contains('filldown')) fillDown(k);
    });
    render();
  }

  root.QDMetaTab = {
    init: init, render: render, exportInfo: exportInfo, groupOf: groupOf,
    _folderGuess: folderGuess, _normStrata: normStrata, PRESETS: PRESETS
  };
})(typeof self !== 'undefined' ? self : this);
