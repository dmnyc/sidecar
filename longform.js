'use strict';

// ---- articles and recipes in the expanded composer ----
//
// Three kinds of writing, one composer: a Note (kind 1, what this page always was), an
// Article (kind 30023, NIP-23 long-form) and a Recipe. A recipe is an article too: the
// same kind, with the sections and tags Zap Cooking reads, so a recipe written here shows
// as a recipe on zap.cooking and as an article in every other long-form reader. The format
// is theirs (MIT, zapcooking/frontend: src/lib/parser.ts createMarkdown and the publish in
// src/routes/create/+page.svelte); RECIPE_FORMAT below follows it to the character, since
// their reader matches the headings and the detail lines exactly.
//
// The panel is a 360px strip and never edits either: both live here, where there is room
// for a title, a toolbar and a readable measure.
(async function () {
  const SC = window.SidecarCore;
  const { h, icon } = SC;
  const { t, tn } = window.SidecarI18n;
  const $ = (id) => document.getElementById(id);
  // Everything below is built once, with its words in it, so it waits for the language
  // file, as compose.js does before it fills the page. Built at once, a German page kept
  // these tabs and labels in English.
  try { await window.SidecarI18n.ready; } catch (_) { /* English, then */ }

  // Toolbar marks, drawn in the same 24px stroke grid as icon(). Static strings only.
  const MARKS = {
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    italic: '<line x1="19" y1="5" x2="10" y2="5"/><line x1="14" y1="19" x2="5" y2="19"/><line x1="15" y1="5" x2="9" y2="19"/>',
    heading: '<path d="M6 5v14M18 5v14M6 12h12"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
    quote: '<path d="M5 17h4l2-4V7H5v6h3zM13 17h4l2-4V7h-6v6h3z"/>',
    list: '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    olist: '<line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><path d="M4 5l1.5-1V9M4 14.5a1.5 1.5 0 1 1 2.5 1L4 18h3"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/>',
    note: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    article: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
    poll: '<line x1="5" y1="20" x2="5" y2="12"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="19" y1="20" x2="19" y2="9"/>',
    recipe: '<path d="M6 13.9A4 4 0 0 1 7.5 6a5 5 0 0 1 9 0A4 4 0 0 1 18 13.9V20H6z"/><line x1="6" y1="16" x2="18" y2="16"/>',
  };
  function mark(name) {
    const wrap = document.createElement('span');
    wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (MARKS[name] || '') + '</svg>';
    return wrap.firstElementChild;
  }

  // Zap Cooking's recipe markdown, exactly as their createMarkdown writes it: the reader on
  // zap.cooking splits on these headings and matches the detail lines by their emoji labels.
  const RECIPE_FORMAT = {
    notes: "## Chef's notes",
    details: '## Details',
    prep: '- ⏲️ Prep time: ',
    cook: '- 🍳 Cook time: ',
    servings: '- 🍽️ Servings: ',
    ingredients: '## Ingredients',
    directions: '## Directions',
    more: '## Additional Resources',
  };
  // ZAP COOKING'S CATEGORIES, as its site lists them (zapcooking/frontend, src/lib/consts.ts
  // recipeTags, at 95c583b). A recipe is filed under `zapcooking-<category>`, and these are
  // the ones Zap Cooking offers when tagging there, so a suggestion from this list is one a
  // person tagging or browsing there can pick too. Anything else may still be typed: it
  // publishes and has a tag page of its own, but nothing in their lists leads to it.
  // Written once, as t() calls, so every name reaches the translators: called with the
  // identity it gives the English names, which are what a recipe is filed under on Zap
  // Cooking and so what is published; called with t it gives what the buttons show.
  const categoryNames = (t) => [
    t('Alcohol'), t('Nuts'), t('American'), t('Apple'), t('Argentinian'), t('Asian'),
    t('Australian'), t('Austrian'), t('Bacon'), t('Baked'), t('Beans'), t('Beef'), t('Belgian'),
    t('Blended'), t('Brazilian'), t('Bread'), t('Breakfast'), t('Broccoli'), t('Cabbage'),
    t('Cajun'), t('Cake'), t('Caribbean'), t('Cheese'), t('Chicken'), t('Chinese'),
    t('Chocolate'), t('Christmas'), t('Cocktail'), t('Coconut'), t('Cookies'), t('Coffee'),
    t('Corn'), t('Cream'), t('Curry'), t('Danish'), t('Dessert'), t('Dominican'), t('Dressing'),
    t('Drinks'), t('Duck'), t('Dumpling'), t('Dutch'), t('Easter'), t('Easy'), t('Eggs'),
    t('English'), t('Ethiopian'), t('Feta'), t('Filipino'), t('Fish'), t('French'), t('Frozen'),
    t('Fruit'), t('Fry'), t('Galician'), t('Garlic'), t('German'), t('Greek'), t('Ham'),
    t('Hungarian'), t('Indian'), t('Irish'), t('Israeli'), t('Italian'), t('Jamaican'), t('Jam'),
    t('Japanese'), t('Korean'), t('Keto'), t('Lamb'), t('Lebanese'), t('Lemons'), t('Lentil'),
    t('Liquor'), t('Liver'), t('Lunch'), t('Meat'), t('Mediterranean'), t('Mexican'),
    t('Middle-Eastern'), t('Milk'), t('Moroccan'), t('Mushrooms'), t('Mutton'), t('Nigerian'),
    t('Noodles'), t('Oven'), t('Palestinian'), t('Pancake'), t('Pasta'), t('Pastry'), t('Pate'),
    t('Peppers'), t('Persian'), t('Peruvian'), t('Pie'), t('Pizza'), t('Polish'), t('Pork'),
    t('Portuguese'), t('Potato'), t('Pub'), t('Quebec'), t('Quick'), t('Raw'), t('Rice'),
    t('Roast'), t('Romanian'), t('Russian'), t('Salad'), t('Sandwich'), t('Sauce'), t('Sausage'),
    t('Seafood'), t('Shaken'), t('Shrimp'), t('Side'), t('Slowcooked'), t('Smoothie'), t('Snack'),
    t('Somali'), t('Soup'), t('Sourdough'), t('Southern'), t('Southwest'), t('Spanish'),
    t('Spice'), t('Spicy'), t('Spinach'), t('Spread'), t('Squash'), t('Steak'), t('Stew'),
    t('Stirred'), t('Stock'), t('Supper'), t('Swedish'), t('Sweet'), t('Swiss'), t('Syrup'),
    t('Thai'), t('Tofu'), t('Tomato'), t('Tortilla'), t('Traditional'), t('Traybake'), t('Tuna'),
    t('Tunisian'), t('Turkey'), t('Turkish'), t('Ukrainian'), t('Uzbek'), t('Veal'),
    t('Vegetables'), t('Vegan'), t('Raw Vegan'), t('Vietnamese'), t('Wholemeal'), t('Wine'),
    t('Yucatecan'), t('Healthy'), t('Gluten Free'),
  ];
  const ZAP_COOKING_CATEGORIES = categoryNames((s) => s);
  // TWO NAMES WERE ALREADY KEYS FOR SOMETHING ELSE: "Raw" is an event's raw data and
  // "Healthy" a relay that works, so a German chip read "Rohdaten". These two take keys of
  // their own. A language without them shows the English name, which is what is published.
  const OWN_CATEGORY_KEY = {
    Raw: ['Raw (recipe category)', () => t('Raw (recipe category)')],
    Healthy: ['Healthy (recipe category)', () => t('Healthy (recipe category)')],
  };
  // `listed` is the name as the list itself translates it, which the pseudo-locale uses.
  function ownCategoryLabel(en, listed) {
    const I = window.SidecarI18n;
    if (I.lang === I.PSEUDO) return listed;
    const [key, label] = OWN_CATEGORY_KEY[en];
    const s = label();
    return s === key ? en : s;
  }
  let categoryLabels = null;
  // A category as shown: its name in the panel's language, or as typed if it is not theirs.
  function categoryLabel(en) {
    if (!categoryLabels) {
      const shown = categoryNames(t);
      categoryLabels = new Map(ZAP_COOKING_CATEGORIES.map((c, i) => [c, OWN_CATEGORY_KEY[c] ? ownCategoryLabel(c, shown[i]) : shown[i]]));
    }
    return categoryLabels.get(en) || en;
  }
  // EACH CATEGORY'S EMOJI, shown beside the name: the shared list in editor-matrix
  // (recipes/categories.json), Zap Cooking's own emoji plus the 21 it had none for. Shown,
  // never published: the tag is the English name alone.
  const CATEGORY_EMOJI = {
    Alcohol: '🍸', Nuts: '🥜', American: '🇺🇸', Apple: '🍎', Argentinian: '🇦🇷', Asian: '🥢',
    Australian: '🇦🇺', Austrian: '🇦🇹', Bacon: '🥓', Baked: '⏲️', Beans: '🧆', Beef: '🐄', Belgian: '🇧🇪',
    Blended: '🥤', Brazilian: '🇧🇷', Bread: '🍞', Breakfast: '🍳', Broccoli: '🥦', Cabbage: '🥬',
    Cajun: '🌶️', Cake: '🍰', Caribbean: '🏝️', Cheese: '🧀', Chicken: '🍗', Chinese: '🥡',
    Chocolate: '🍫', Christmas: '🎄', Cocktail: '🍹', Coconut: '🥥', Cookies: '🍪', Coffee: '☕',
    Corn: '🌽', Cream: '🥛', Curry: '🍛', Danish: '🇩🇰', Dessert: '🧁', Dominican: '🇩🇴', Dressing: '🫗',
    Drinks: '🥤', Duck: '🦆', Dumpling: '🥟', Dutch: '🇳🇱', Easter: '🐰', Easy: '😌', Eggs: '🥚',
    English: '🏴', Ethiopian: '🇪🇹', Feta: '🧀', Filipino: '🇵🇭', Fish: '🐟', French: '🇫🇷', Frozen: '🥶',
    Fruit: '🍇', Fry: '🍟', Galician: '🐚', Garlic: '🧄', German: '🇩🇪', Greek: '🇬🇷', Ham: '🍖',
    Hungarian: '🇭🇺', Indian: '🇮🇳', Irish: '☘️', Israeli: '🇮🇱', Italian: '🇮🇹', Jamaican: '🇯🇲',
    Jam: '🍓', Japanese: '🇯🇵', Korean: '🇰🇷', Keto: '🥓', Lamb: '🐑', Lebanese: '🇱🇧', Lemons: '🍋',
    Lentil: '🫘', Liquor: '🥃', Liver: '🍖', Lunch: '🥪', Meat: '🥩', Mediterranean: '🏖️', Mexican: '🇲🇽',
    'Middle-Eastern': '🧆', Milk: '🥛', Moroccan: '🇲🇦', Mushrooms: '🍄', Mutton: '🐑', Nigerian: '🇳🇬',
    Noodles: '🍜', Oven: '🔥', Palestinian: '🇵🇸', Pancake: '🥞', Pasta: '🍝', Pastry: '🥐', Pate: '🥖',
    Peppers: '🌶️', Persian: '🇮🇷', Peruvian: '🇵🇪', Pie: '🥧', Pizza: '🍕', Polish: '🇵🇱', Pork: '🐖',
    Portuguese: '🇵🇹', Potato: '🥔', Pub: '🍺', Quebec: '🍁', Quick: '🌭', Raw: '🥕', Rice: '🍚',
    Roast: '🍖', Romanian: '🇷🇴', Russian: '🇷🇺', Salad: '🥗', Sandwich: '🥪', Sauce: '🍲', Sausage: '🌭',
    Seafood: '🦐', Shaken: '🫨', Shrimp: '🦐', Side: '🍽️', Slowcooked: '⏳', Smoothie: '🥤', Snack: '🍿',
    Somali: '🇸🇴', Soup: '🍲', Sourdough: '🍞', Southern: '🫓', Southwest: '🌵', Spanish: '🇪🇸',
    Spice: '🌶️', Spicy: '🌶️', Spinach: '🍃', Spread: '🧈', Squash: '🎃', Steak: '🥩', Stew: '🍲',
    Stirred: '🥄', Stock: '🍲', Supper: '🍽️', Swedish: '🇸🇪', Sweet: '🍬', Swiss: '🇨🇭', Syrup: '🍯',
    Thai: '🇹🇭', Tofu: '🥢', Tomato: '🍅', Tortilla: '🌮', Traditional: '📜', Traybake: '🍰', Tuna: '🐟',
    Tunisian: '🇹🇳', Turkey: '🦃', Turkish: '🇹🇷', Ukrainian: '🇺🇦', Uzbek: '🇺🇿', Veal: '🐄',
    Vegetables: '🥦', Vegan: '🌱', 'Raw Vegan': '🌿', Vietnamese: '🇻🇳', Wholemeal: '🌾', Wine: '🍷',
    Yucatecan: '🇲🇽', Healthy: '🍏', 'Gluten Free': '🥗',
  };
  // A category as a chip or a tag shows it: the emoji, then the name in the panel's language.
  const categoryShown = (en) => (CATEGORY_EMOJI[en] ? CATEGORY_EMOJI[en] + ' ' : '') + categoryLabel(en);
  // WHAT IS SUGGESTED BEFORE ANYTHING IS TYPED, by the month, and only from the list above.
  // Zap Cooking has no Thanksgiving category, so Turkey, Roast and Pie stand in for it.
  const SEASONAL_CATEGORIES = {
    winter: ['Soup', 'Stew', 'Slowcooked', 'Curry', 'Bread', 'Roast', 'Chocolate', 'Healthy'],
    spring: ['Easter', 'Lamb', 'Eggs', 'Salad', 'Spinach', 'Quick', 'Breakfast', 'Dessert'],
    summer: ['Salad', 'Fruit', 'Smoothie', 'Drinks', 'Corn', 'Tomato', 'Quick', 'Dessert'],
    fall: ['Apple', 'Squash', 'Soup', 'Stew', 'Bread', 'Slowcooked', 'Pie', 'Dessert'],
    november: ['Turkey', 'Roast', 'Pie', 'Squash', 'Potato', 'Bread', 'Soup', 'Dessert'],
    december: ['Christmas', 'Cookies', 'Cake', 'Roast', 'Ham', 'Chocolate', 'Drinks', 'Dessert'],
  };
  // month: 0 for January, as Date#getMonth gives it.
  function seasonalCategories(month) {
    const season = month === 10 ? 'november' : month === 11 ? 'december'
      : month <= 1 ? 'winter' : month <= 3 ? 'spring' : month <= 7 ? 'summer' : 'fall';
    return SEASONAL_CATEGORIES[season];
  }
  // WHILE TYPING, the categories it matches: those that start with it first, then those
  // that contain it, eight at most. "veg" offers Vegan and Vegetables.
  function matchingCategories(typed) {
    const q = typed.replace(/^#/, '').trim().toLowerCase();
    if (!q) return [];
    // Either name finds it: the one shown, or the English one it is filed under.
    const names = (c) => [c.toLowerCase(), categoryLabel(c).toLowerCase()];
    const starts = ZAP_COOKING_CATEGORIES.filter((c) => names(c).some((n) => n.startsWith(q)));
    const inside = ZAP_COOKING_CATEGORIES.filter((c) => !starts.includes(c) && names(c).some((n) => n.includes(q)));
    return starts.concat(inside).slice(0, 8);
  }
  function recipeCategoryHints(typed) {
    return typed.trim() ? matchingCategories(typed) : seasonalCategories(new Date().getMonth());
  }
  // A typed category that is one of theirs takes their spelling: "side" becomes "Side", and
  // its translated name becomes the English one it is filed under.
  function canonicalCategory(v) {
    const low = v.toLowerCase();
    return ZAP_COOKING_CATEGORIES.find((c) => c.toLowerCase() === low || categoryLabel(c).toLowerCase() === low) || v;
  }

  const state = {
    mode: 'note',
    article: { title: '', summary: '', cover: [], topics: [], body: '' },
    recipe: {
      title: '', summary: '', photos: [], notes: '', prep: '', cook: '', servings: '',
      ingredients: [], directions: [], categories: [], source: '',
    },
  };

  // ---- small pieces ----

  function field(labelText, input, hint) {
    return h('label', { className: 'lf-field' }, [
      h('span', { className: 'lf-label', textContent: labelText }),
      input,
      hint ? h('span', { className: 'lf-hint', textContent: hint }) : null,
    ]);
  }

  // Chips that become `t` tags. Enter or a comma adds one; Backspace in an empty box removes the last.
  // `hints`, if given, is a function of what is typed returning the chips to offer under the
  // box, and `canonical` the spelling a typed value takes.
  function chipInput(list, placeholder, hints, canonical, label = (v) => v) {
    const box = h('div', { className: 'lf-chips' });
    const input = h('input', { type: 'text', className: 'lf-chip-input', placeholder, 'aria-label': placeholder });
    const hintRow = hints ? h('div', { className: 'lf-chip-hints' }) : null;
    function draw() {
      box.replaceChildren(...list.map((v, i) => h('span', { className: 'lf-chip' }, [
        h('span', { textContent: label(v) }),
        h('button', { type: 'button', className: 'lf-chip-x', title: t('Remove'), onclick: () => { list.splice(i, 1); draw(); } }, [icon('x')]),
      ])), input);
      paintHints();
      document.dispatchEvent(new CustomEvent('lf-change'));
    }
    // ONE ROW OF SUGGESTIONS, as many as fit: a second row holding one stray pick looks like
    // a mistake, and how many fit changes with the window, the language and the emoji. The
    // order is the order of preference, so the ones that drop are the last.
    function fitHints() {
      if (!hintRow || !hintRow.isConnected) return;
      const all = [...hintRow.children];
      all.forEach((b) => b.classList.remove('hidden'));
      const top = all.length ? all[0].offsetTop : 0;
      all.forEach((b) => { if (b.offsetTop > top) b.classList.add('hidden'); });
    }
    if (hintRow && window.ResizeObserver) {
      let lastWidth = 0;
      new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w !== lastWidth) { lastWidth = w; fitHints(); } }).observe(hintRow);
    }
    // A suggestion still offered keeps its button: Tab out of the box is already on its way to
    // one when the box's blur repaints, and a button rebuilt under it sends the focus to the
    // top of the page.
    const hintBtns = new Map();
    function paintHints() {
      if (!hintRow) return;
      const left = hints(input.value).filter((x) => !list.some((v) => v.toLowerCase() === x.toLowerCase()));
      for (const k of [...hintBtns.keys()]) if (!left.includes(k)) hintBtns.delete(k);
      hintRow.replaceChildren(...left.map((x) => {
        if (!hintBtns.has(x)) hintBtns.set(x, h('button', {
          type: 'button', className: 'lf-chip-hint', textContent: '+ ' + label(x),
          // Before the box's blur adds the half-typed word: a pick replaces it.
          onmousedown: (e) => e.preventDefault(),
          onclick: () => { list.push(x); input.value = ''; draw(); },
        }));
        return hintBtns.get(x);
      }));
      fitHints();
    }
    // Only a word that was typed changes anything: leaving an empty box redraws nothing, so the
    // focus Tab is moving lands where it was going.
    function add() {
      const typed = input.value;
      if (!typed) return;
      let v = typed.replace(/^#/, '').trim();
      if (v && canonical) v = canonical(v);
      input.value = '';
      if (v && !list.some((x) => x.toLowerCase() === v.toLowerCase())) { list.push(v); draw(); }
      else paintHints();
    }
    input.addEventListener('input', paintHints);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
      else if (e.key === 'Backspace' && !input.value && list.length) { list.pop(); draw(); }
    });
    input.addEventListener('blur', add);
    box.addEventListener('click', (e) => { if (e.target === box) input.focus(); });
    draw();
    return { el: h('div', {}, [box, hintRow]), draw };
  }

  // ---- a markdown field that writes like a word processor ----
  //
  // The field stays plain markdown, exactly what is published, but the habits of a word
  // processor work in it:
  //   - formatted text pasted or dropped in keeps its formatting, written as markdown
  //     (Cmd+Shift+V pastes it plain)
  //   - Cmd+B, Cmd+I and Cmd+K make the selection bold, italic or a link, and Cmd+B or
  //     Cmd+I again on a marked selection takes the marks off
  //   - Enter in a list item starts the next item, numbered on from this one, and Enter on
  //     an empty item ends the list; a quote continues the same way
  // Every change goes through insertText, so one Cmd+Z takes back one step.
  const BLOCK_LEAD = /^(#{1,6} |> |[-*+] |\d+[.)] |```|---)/;
  function insertAt(ta, a, b, text, select) {
    ta.focus();
    ta.setSelectionRange(a, b);
    // An empty insert would leave the caret where Chrome likes; a delete leaves it at the cut.
    if (text) document.execCommand('insertText', false, text);
    else if (a !== b) document.execCommand('delete');
    if (select) ta.setSelectionRange(a + select[0], a + select[1]);
  }
  // `onImages(files, at)`: pictures pasted or dropped into the field, and where they landed.
  // Without it, a picture is left to the browser, which does nothing with one in a text field.
  function markdownField(ta, { headings = true, onImages = null } = {}) {
    const imagesOf = (dt) => (onImages && dt && dt.files ? [...dt.files].filter((f) => f.type.startsWith('image/')) : []);
    let plainNext = false;
    const insertMarkdown = (md, a, b) => {
      // Zap Cooking reads a recipe by its ## headings, so in a recipe's notes a pasted heading
      // is a bold line instead: still set apart, and the recipe still reads.
      if (!headings) md = md.replace(/^#{1,6} +(.+)$/gm, '**$1**');
      // A heading, list or quote starts on a line of its own.
      const lead = BLOCK_LEAD.test(md) && a > 0 && ta.value[a - 1] !== '\n' ? '\n' : '';
      insertAt(ta, a, b, lead + md);
    };
    const fromTransfer = (dt) => {
      if (!dt || (dt.files && dt.files.length)) return null;
      const html = dt.getData('text/html');
      return html ? SC.markdownFromHtml(html) : null;
    };
    ta.addEventListener('paste', (e) => {
      const pics = imagesOf(e.clipboardData);
      if (pics.length) { e.preventDefault(); plainNext = false; onImages(pics, ta.selectionStart, ta.selectionEnd); return; }
      const plain = plainNext;
      plainNext = false;
      const md = plain ? null : fromTransfer(e.clipboardData);
      if (md == null) {
        // Plain: the clipboard's own text, or the words of an HTML-only clipboard.
        if (e.clipboardData && !e.clipboardData.getData('text/plain') && e.clipboardData.getData('text/html')) {
          e.preventDefault();
          insertAt(ta, ta.selectionStart, ta.selectionEnd, SC.textFromHtml(e.clipboardData.getData('text/html')));
        }
        return;
      }
      e.preventDefault();
      insertMarkdown(md, ta.selectionStart, ta.selectionEnd);
    });
    ta.addEventListener('drop', (e) => {
      const pics = imagesOf(e.dataTransfer);
      const md = pics.length ? null : fromTransfer(e.dataTransfer);
      if (!pics.length && md == null) return;
      e.preventDefault();
      let at = ta.value.length;
      const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null;
      if (pos && pos.offsetNode === ta) at = pos.offset;
      if (pics.length) onImages(pics, at, at);
      else insertMarkdown(md, at, at);
    });
    // Bold and italic toggle: marks already around the selection, or inside its ends, come off.
    const toggle = (mark) => {
      const { selectionStart: a, selectionEnd: b, value } = ta;
      const n = mark.length;
      const sel = value.slice(a, b);
      if (value.slice(a - n, a) === mark && value.slice(b, b + n) === mark) {
        insertAt(ta, a - n, b + n, sel, [0, sel.length]);
      } else if (sel.length >= 2 * n && sel.startsWith(mark) && sel.endsWith(mark)) {
        insertAt(ta, a, b, sel.slice(n, -n), [0, sel.length - 2 * n]);
      } else {
        insertAt(ta, a, b, mark + sel + mark, [n, n + sel.length]);
      }
    };
    const link = () => {
      const { selectionStart: a, selectionEnd: b, value } = ta;
      const sel = value.slice(a, b);
      if (/^https?:\/\/\S+$/.test(sel)) { insertAt(ta, a, b, '[](' + sel + ')', [1, 1]); return; }
      const text = '[' + sel + '](https://)';
      // The address is selected, ready to be typed over; with no words yet, the caret waits for them.
      insertAt(ta, a, b, text, sel ? [sel.length + 3, sel.length + 11] : [1, 1]);
    };
    ta.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const cmd = (e.metaKey || e.ctrlKey) && !e.altKey;
      const key = (e.key || '').toLowerCase();
      if (cmd && e.shiftKey && key === 'v') { plainNext = true; setTimeout(() => { plainNext = false; }, 500); return; }
      if (cmd && !e.shiftKey && (key === 'b' || key === 'i' || key === 'k')) {
        e.preventDefault();
        if (key === 'k') link(); else toggle(key === 'b' ? '**' : '_');
        return;
      }
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const { selectionStart: a, selectionEnd: b, value } = ta;
      if (a !== b) return;
      const lineStart = value.lastIndexOf('\n', a - 1) + 1;
      const lineEnd = value.indexOf('\n', a) === -1 ? value.length : value.indexOf('\n', a);
      const line = value.slice(lineStart, a);
      const item = line.match(/^(\s*)(?:([-*+])|(\d+)([.)]))( +)(\[[ xX]\] +)?/);
      const quote = !item && line.match(/^(\s*(?:> ?)+)/);
      const m = item || quote;
      if (!m || line.length < m[0].length) return;
      e.preventDefault();
      // An empty item (nothing after the marker on the whole line) ends the list.
      if (line.length === m[0].length && !value.slice(a, lineEnd).trim()) { insertAt(ta, lineStart, lineEnd, ''); return; }
      const next = item
        ? m[1] + (m[2] || (Number(m[3]) + 1) + m[4]) + m[5] + (m[6] ? '[ ] ' : '')
        : m[1].replace(/ ?$/, ' ');
      insertAt(ta, a, a, '\n' + next);
    });
  }

  // A pasted list, as the lines a list editor takes: one item a line, its bullet or number
  // taken off ("1.", "-", "•", "Step 2:"), blank lines dropped.
  const LIST_MARKER = /^\s*(?:[-*+–—](?=\s)|[•▪◦·‣]|\d+[.)](?=\s)|\(\d+\)|step\s*\d+\s*[.:)-]?(?=\s))\s*(\[[ xX]\]\s*)?/i;
  const listLines = (text) => String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(LIST_MARKER, '').trim()).filter(Boolean);

  // An ordered list a person builds one line at a time: ingredients, directions.
  //
  // AN ITEM IS EDITED IN PLACE, as on Zap Cooking: the pencil, or a click on its words, turns
  // it into a box. Enter or leaving the box keeps the change, Escape takes it back, and a box
  // emptied keeps the old words (the X removes an item). A list pasted into the box becomes
  // items there, as it does in the box below.
  //
  // AN ITEM IS MOVED BY ITS GRIP, as on Zap Cooking: dragged by the dots at its start, it lands
  // before the row it is dropped on when dropped on that row's top half and after it on the
  // bottom half, so it can go past the last one; a line shows where. Only the grip starts a
  // drag, so the words stay a place to click and select. From the keyboard, the grip's arrow
  // keys move the item one place, and Move up stays for a single press.
  function listEditor(list, { numbered, placeholder, addLabel, label }) {
    const ol = h(numbered ? 'ol' : 'ul', { className: 'lf-list' + (numbered ? ' is-numbered' : '') });
    const input = h('input', { type: 'text', className: 'lf-list-input', placeholder, 'aria-label': label || placeholder });
    const addBtn = h('button', { type: 'button', className: 'secondary lf-list-add', textContent: addLabel });
    let editing = -1;
    let openBox = null;
    // The open box's words go into the list before anything else redraws it: a press on
    // another item, Move up or Remove keeps what was typed rather than dropping it.
    function commit() {
      if (!openBox) return;
      const v = openBox.value.trim();
      if (v && list[editing] !== undefined) list[editing] = v;
      openBox = null;
    }
    function edit(i) { commit(); editing = i; draw(); }
    function close(keep) {
      if (!openBox) return;
      if (keep) commit(); else openBox = null;
      editing = -1;
      draw();
    }
    function editBox(i) {
      const box = h('input', { type: 'text', className: 'lf-list-edit', value: list[i], dir: 'auto', 'aria-label': t('Edit {{name}}', { name: list[i] }) });
      box.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') { e.preventDefault(); close(true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
      });
      box.addEventListener('blur', () => { if (openBox === box) close(true); });
      box.addEventListener('paste', (e) => {
        const lines = listLines(SC.transferText(e.clipboardData));
        if (lines.length < 2) return;
        e.preventDefault();
        const v = box.value;
        lines[0] = (v.slice(0, box.selectionStart) + ' ' + lines[0]).trim();
        lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + v.slice(box.selectionEnd)).trim();
        openBox = null;
        list.splice(i, 1, ...lines);
        editing = -1;
        draw();
      });
      return box;
    }
    // Buttons and words act on mousedown's default being held back, so the open box keeps
    // focus until the press has done its work.
    const hold = (e) => e.preventDefault();

    // ---- moving an item ----
    const DRAG_TYPE = 'application/x-sidecar-list-item'; // its own type: dropped anywhere else, it carries no text
    let dragFrom = -1;
    function moveItem(from, to) {
      if (from === to || from < 0 || to < 0 || to >= list.length) return;
      commit();
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      editing = -1;
      draw();
    }
    const clearMarks = () => ol.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    const below = (e, li) => { const r = li.getBoundingClientRect(); return e.clientY >= r.top + r.height / 2; };
    function grip(i, li) {
      // Named for its item, since every row has one, and described with the keys that move it.
      const g = h('button', {
        type: 'button', className: 'lf-icon-btn lf-list-grip', title: t('Drag to reorder'),
        'aria-label': t('Move {{item}}', { item: list[i] }),
        'aria-description': t('Drag to reorder, or use the up and down arrow keys'),
      }, [icon('grip')]);
      // The row is draggable only while the grip is held.
      g.addEventListener('mousedown', () => { li.draggable = true; });
      g.addEventListener('mouseup', () => { li.draggable = false; });
      g.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const to = i + (e.key === 'ArrowUp' ? -1 : 1);
        if (to < 0 || to >= list.length) return;
        moveItem(i, to);
        const moved = ol.children[to] && ol.children[to].querySelector('.lf-list-grip');
        if (moved) moved.focus();
      });
      return g;
    }
    function dragRow(li, i) {
      li.addEventListener('dragstart', (e) => {
        if (!li.draggable) return;
        dragFrom = i;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(DRAG_TYPE, String(i));
        li.classList.add('is-dragging');
      });
      li.addEventListener('dragover', (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const after = below(e, li);
        if (li.classList.contains(after ? 'drop-after' : 'drop-before')) return;
        clearMarks();
        // No line where the item already is: before or after itself, or the gap it left.
        if (i === dragFrom || (after && i === dragFrom - 1) || (!after && i === dragFrom + 1)) return;
        li.classList.add(after ? 'drop-after' : 'drop-before');
      });
      li.addEventListener('dragleave', (e) => { if (!li.contains(e.relatedTarget)) li.classList.remove('drop-before', 'drop-after'); });
      li.addEventListener('drop', (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        let to = below(e, li) ? i + 1 : i;
        if (dragFrom < to) to--;
        const from = dragFrom;
        dragFrom = -1;
        moveItem(from, to);
      });
      li.addEventListener('dragend', () => {
        dragFrom = -1;
        li.draggable = false;
        li.classList.remove('is-dragging');
        clearMarks();
      });
    }

    function draw() {
      ol.replaceChildren(...list.map((v, i) => { const li = h('li', { className: 'lf-list-item' + (i === editing ? ' is-editing' : '') }); dragRow(li, i); li.append(
        grip(i, li),
        h('span', { className: 'lf-list-mark', textContent: numbered ? String(i + 1) : '•' }),
        i === editing ? (openBox = editBox(i)) : h('span', { className: 'lf-list-text', textContent: v, onmousedown: hold, onclick: () => edit(i) }),
        h('span', { className: 'lf-list-actions' }, [
          i === editing
            ? h('button', { type: 'button', className: 'lf-icon-btn lf-list-save', title: t('Save'), onmousedown: hold, onclick: () => close(true) }, [icon('check')])
            : h('button', { type: 'button', className: 'lf-icon-btn lf-list-edit-btn', title: t('Edit {{name}}', { name: v }), onmousedown: hold, onclick: () => edit(i) }, [icon('edit')]),
          h('button', { type: 'button', className: 'lf-icon-btn', title: t('Move up'), disabled: i === 0, onmousedown: hold, onclick: () => {
            commit();
            [list[i - 1], list[i]] = [list[i], list[i - 1]];
            if (editing === i) editing = i - 1; else if (editing === i - 1) editing = i;
            draw();
          } }, [icon('arrow-up')]),
          h('button', { type: 'button', className: 'lf-icon-btn', title: t('Remove'), onmousedown: hold, onclick: () => {
            commit();
            list.splice(i, 1);
            if (editing === i) editing = -1; else if (editing > i) editing--;
            draw();
          } }, [icon('x')]),
        ]),
      ); return li; }));
      ol.classList.toggle('hidden', !list.length);
      document.dispatchEvent(new CustomEvent('lf-change'));
      const box = ol.querySelector('.lf-list-edit');
      if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    }
    function add() {
      const v = input.value.trim();
      if (!v) return;
      list.push(v);
      input.value = '';
      draw();
      input.focus();
    }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    // A whole list pasted at once (copied from a recipe page) comes in as its items, not one line.
    input.addEventListener('paste', (e) => {
      const lines = listLines(SC.transferText(e.clipboardData));
      if (lines.length < 2) return;
      e.preventDefault();
      const v = input.value;
      lines[0] = (v.slice(0, input.selectionStart) + ' ' + lines[0]).trim();
      lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + v.slice(input.selectionEnd)).trim();
      list.push(...lines);
      input.value = '';
      draw();
      input.focus();
    });
    addBtn.addEventListener('click', add);
    draw();
    return { el: h('div', { className: 'lf-list-wrap' }, [ol, h('div', { className: 'lf-list-row' }, [input, addBtn])]), draw };
  }

  // Pictures for an article's cover or a recipe's photos, in the same strip the note's
  // attachments use: drag or the arrows set the order, the ALT chip describes each one, the
  // bin removes it. Added by upload, by dropping files on the box, or by pasting a link,
  // which sits behind its own small disclosure as on Zap Cooking.
  //
  // THE COVER LOOKS LIKE A COVER (`cover`: an article's and a recipe's pictures). The first picture is drawn large, at the 1.91:1 a link preview crops it
  // to, labeled Cover photo, with its own ALT and remove; the rest sit in the strip under it.
  // Any of them becomes the cover by a tap on it, by its left arrow from the first place, or
  // by dragging it onto the cover. As on Zap Cooking's own form.
  function imagePicker(list, { max, labelText, sub, cover: coverMode = false, coverLabel, moreLabel, moreSub }) {
    const wrap = h('div', { className: 'lf-images' });
    const err = h('p', { className: 'error lf-img-err' });
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: max > 1, hidden: true });
    const drop = h('button', { type: 'button', className: 'lf-drop' }, [
      mark('image'),
      h('span', { className: 'lf-drop-text' }, [h('strong', { textContent: labelText }), h('span', { textContent: sub })]),
    ]);
    const strip = h('div', { className: 'compose-thumbs lf-strip' });
    const coverBox = h('div', { className: 'lf-cover hidden' });
    const moreHead = h('span', { className: 'lf-label lf-more-head hidden', textContent: t('More photos') });
    const urlInput = h('input', { type: 'url', placeholder: 'https://', className: 'lf-url-input', 'aria-label': t('Add image by link') });
    const urlAdd = h('button', { type: 'button', className: 'secondary', textContent: t('Add') });
    const urlRow = h('div', { className: 'lf-list-row lf-url-row hidden' }, [urlInput, urlAdd]);
    const urlToggle = h('button', { type: 'button', className: 'lf-disclose', 'aria-expanded': 'false', textContent: '+ ' + t('Add image by link') });
    let altRow = null; let altFor = -1;
    // The links of the pictures, as the note's attachment drawer lists them: one row each,
    // with a copy button, folded to one line until it is wanted.
    const linksToggle = h('button', { type: 'button', className: 'compose-media-toggle' }, [icon('chevron-down'), h('span', { className: 'compose-media-toggle-label' })]);
    const linksList = h('div', { className: 'compose-media-drawer hidden' });
    const links = h('div', { className: 'compose-media-note lf-links hidden' }, [linksToggle, linksList]);
    linksToggle.addEventListener('click', () => {
      linksList.classList.toggle('hidden');
      linksToggle.classList.toggle('open', !linksList.classList.contains('hidden'));
    });

    const full = () => list.length >= max;
    function closeAlt() { if (altRow) { altRow.remove(); altRow = null; } altFor = -1; }
    function openAlt(i, { keep = false } = {}) {
      if (altFor === i) { if (!keep) closeAlt(); return; }
      closeAlt();
      altFor = i;
      const save = (v) => { const c = SC.capAltText(SC.normalizeAltBreaks(v)); if (c) list[i].alt = c; else delete list[i].alt; draw(); };
      altRow = SC.buildAltEditorRow({ url: list[i].url, alt: list[i].alt, count: list.length, onChange: save, onSave: (v) => { closeAlt(); save(v); } });
      strip.after(altRow);
    }
    // The cover, large: what readers see first and what a link preview shows.
    function drawCover(dragState) {
      const m = list[0];
      coverBox.classList.toggle('hidden', !m);
      if (!m) { coverBox.replaceChildren(); return; }
      const img = h('img', { src: m.url, referrerPolicy: 'no-referrer', draggable: false, alt: m.alt || '' });
      img.addEventListener('error', () => coverBox.classList.add('is-broken'));
      coverBox.classList.remove('is-broken', 'drop-target');
      coverBox.replaceChildren(
        img,
        h('button', {
          type: 'button', className: 'compose-thumb-alt' + (m.alt ? ' has-alt' : ''),
          title: m.alt ? t('Edit the image description') : t('Add a description'),
          textContent: m.alt ? '✓ ALT' : '+ ALT', onclick: () => openAlt(0),
        }),
        h('button', { type: 'button', className: 'compose-thumb-x', title: t('Remove'), onclick: () => { closeAlt(); list.splice(0, 1); draw(); } }, [icon('trash')]),
        h('span', { className: 'lf-cover-chip' }, [mark('image'), h('span', { textContent: t('Cover photo') })]),
      );
      // A picture from the strip dropped here becomes the cover.
      coverBox.ondragover = (e) => { if (dragState.from > 0) { e.preventDefault(); coverBox.classList.add('drop-target'); } };
      coverBox.ondragleave = () => coverBox.classList.remove('drop-target');
      coverBox.ondrop = (e) => { e.preventDefault(); const f = dragState.from; dragState.from = -1; move(f, 0); };
    }
    function move(from, to) {
      if (to < 0 || to >= list.length || from === to) return;
      closeAlt();
      const [x] = list.splice(from, 1);
      list.splice(to, 0, x);
      draw();
    }
    function draw() {
      const drag = { from: -1 };
      // With a cover drawn large, the strip holds the rest; each keeps its place in `list`.
      const first = coverMode ? 1 : 0;
      if (coverMode) drawCover(drag);
      strip.replaceChildren(...list.slice(first).map((m, k) => {
        const i = k + first;
        const cell = h('div', { className: 'compose-thumb', draggable: list.length > 1 });
        const img = h('img', { src: m.url, referrerPolicy: 'no-referrer', draggable: false, alt: m.alt || '' });
        img.addEventListener('error', () => cell.classList.add('is-broken'));
        cell.append(img);
        if (coverMode) {
          // A tap on the picture (not on its buttons) makes it the cover.
          cell.title = t('Make cover');
          img.classList.add('lf-make-cover');
          img.addEventListener('click', () => move(i, 0));
        }
        cell.addEventListener('dragstart', (e) => { drag.from = i; cell.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
        cell.addEventListener('dragover', (e) => { if (drag.from < 0 || drag.from === i) return; e.preventDefault(); cell.classList.add('drop-target'); });
        cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
        cell.addEventListener('drop', (e) => { e.preventDefault(); const f = drag.from; drag.from = -1; move(f, i); });
        cell.addEventListener('dragend', () => { drag.from = -1; cell.classList.remove('dragging'); });
        const alt = h('button', {
          type: 'button', className: 'compose-thumb-alt' + (m.alt ? ' has-alt' : ''),
          title: m.alt ? t('Edit the image description') : t('Add a description'),
          textContent: m.alt ? '✓ ALT' : '+ ALT', onclick: () => openAlt(i),
        });
        cell.append(alt);
        if (list.length > 1) {
          const step = (dir, label) => h('button', {
            type: 'button', className: 'compose-thumb-move ' + (dir < 0 ? 'left' : 'right'), title: label,
            onclick: () => move(i, i + dir),
          }, [icon(dir < 0 ? 'arrow-left' : 'arrow-right')]);
          if (i > 0) cell.append(step(-1, coverMode && i === 1 ? t('Make cover') : t('Move earlier')));
          if (i < list.length - 1) cell.append(step(1, t('Move later')));
        }
        cell.append(h('button', {
          type: 'button', className: 'compose-thumb-x', title: t('Remove'),
          onclick: () => { closeAlt(); list.splice(i, 1); draw(); },
        }, [icon('trash')]));
        return cell;
      }));
      links.classList.toggle('hidden', !list.length);
      linksToggle.lastChild.textContent = tn('{{count}} image link', '{{count}} image links', list.length);
      linksList.replaceChildren(...list.map((m) => SC.buildUrlRow(m.url)));
      if (coverMode) {
        // Empty, the box asks for the cover; with one, it adds the rest, under More photos.
        moreHead.classList.toggle('hidden', list.length < 2);
        strip.classList.toggle('hidden', list.length < 2);
        const [strong, small] = drop.querySelector('.lf-drop-text').children;
        strong.textContent = list.length ? (moreLabel || labelText) : (coverLabel || labelText);
        small.textContent = list.length ? (moreSub || sub) : sub;
      }
      drop.classList.toggle('hidden', full());
      urlToggle.classList.toggle('hidden', full());
      if (full()) urlRow.classList.add('hidden');
      document.dispatchEvent(new CustomEvent('lf-change'));
    }
    async function upload(files) {
      err.textContent = '';
      const imgs = [...files].filter((f) => f.type.startsWith('image/')).slice(0, max - list.length);
      if (!imgs.length) return;
      drop.disabled = true;
      drop.classList.add('is-uploading');
      try {
        for (const f of imgs) list.push({ url: await window.SidecarComposeUpload(f) });
      } catch (e) {
        err.replaceChildren(...SC.uploadErrorParts(e));
      }
      drop.disabled = false;
      drop.classList.remove('is-uploading');
      draw();
    }
    function addUrl() {
      err.textContent = '';
      let u;
      try { u = new URL(urlInput.value.trim()); } catch (_) { err.textContent = t('Enter a full link, starting with https://'); return; }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') { err.textContent = t('Enter a full link, starting with https://'); return; }
      if (list.some((m) => m.url === u.href)) { err.textContent = t('That picture is already added.'); return; }
      list.push({ url: u.href });
      urlInput.value = '';
      draw();
    }
    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { upload(fileInput.files || []); fileInput.value = ''; });
    drop.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); drop.classList.add('drop-target'); } });
    drop.addEventListener('dragleave', () => drop.classList.remove('drop-target'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drop-target'); upload(e.dataTransfer.files); });
    urlToggle.addEventListener('click', () => {
      const open = urlRow.classList.toggle('hidden') === false;
      urlToggle.setAttribute('aria-expanded', String(open));
      if (open) urlInput.focus();
    });
    urlAdd.addEventListener('click', addUrl);
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } });
    wrap.append(coverBox, moreHead, strip, links, drop, h('div', { className: 'lf-img-more' }, [urlToggle]), urlRow, err, fileInput);
    draw();
    return { el: wrap, draw, openAlt: (i) => { if (list[i]) openAlt(i, { keep: true }); } };
  }

  // An optional field that stays a one-line link until it is wanted, or already has a value.
  function disclosure(labelText, body, hasValue) {
    const btn = h('button', { type: 'button', className: 'lf-disclose', 'aria-expanded': 'false', textContent: '+ ' + labelText });
    const panel = h('div', { className: 'lf-disclosed hidden' }, [body]);
    const set = (open) => { panel.classList.toggle('hidden', !open); btn.classList.toggle('hidden', open); btn.setAttribute('aria-expanded', String(open)); };
    btn.addEventListener('click', () => { set(true); const f = panel.querySelector('input, textarea'); if (f) f.focus(); });
    return { el: h('div', {}, [btn, panel]), sync: () => set(hasValue()) };
  }

  // ---- markdown, read for the Preview ----
  //
  // A small renderer built with h(), never innerHTML: headings, paragraphs, emphasis, code,
  // links, images, lists, quotes and rules. Raw HTML stays text, and a link or an image is
  // drawn only for an http(s) address, so nothing in a body can run or load anything else.
  const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch (_) { return null; } };
  function inline(text) {
    const out = [];
    const re = /(`[^`\n]+`)|<(https?:\/\/[^>\s]+)>|!\[([^\]\n]*)\]\(([^)\s]+)\)|\[([^\]\n]+)\]\(([^)\s]+)\)|(\*\*|__)(?=\S)([\s\S]+?\S)\7|(\*|_)(?=\S)([\s\S]+?\S)\9/g;
    let last = 0; let m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1]) out.push(h('code', { textContent: m[1].slice(1, -1) }));
      else if (m[2] !== undefined) {
        // <https://…>, an address written to be a link (a recipe's source is written so).
        const href = safeUrl(m[2]);
        out.push(href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: m[2] }) : m[0]);
      } else if (m[4] !== undefined) {
        const src = safeUrl(m[4]);
        out.push(src ? h('img', { src, alt: m[3], referrerPolicy: 'no-referrer', loading: 'lazy' }) : m[0]);
      } else if (m[6] !== undefined) {
        const href = safeUrl(m[6]);
        out.push(href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, inline(m[5])) : m[0]);
      } else if (m[7]) out.push(h('strong', {}, inline(m[8])));
      else out.push(h('em', {}, inline(m[10])));
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  function renderMarkdown(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    const isBlockStart = (l) => /^(#{1,6}\s|>|```|\s*([-*+]|\d+[.)])\s|\s*([-*_])(\s*\3){2,}\s*$)/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (/^```/.test(line)) {
        const code = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
        i++;
        out.push(h('pre', {}, [h('code', { textContent: code.join('\n') })]));
      } else if (/^#{1,6}\s/.test(line)) {
        const level = line.match(/^#+/)[0].length;
        out.push(h('h' + level, {}, inline(line.replace(/^#+\s*/, '').replace(/\s#+\s*$/, ''))));
        i++;
      } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        out.push(h('hr')); i++;
      } else if (/^>/.test(line)) {
        const q = [];
        for (; i < lines.length && /^>/.test(lines[i]); i++) q.push(lines[i].replace(/^>\s?/, ''));
        out.push(h('blockquote', {}, renderMarkdown(q.join('\n'))));
      } else if (/^\s*([-*+]|\d+[.)])\s/.test(line)) {
        const ordered = /^\s*\d/.test(line);
        const items = [];
        for (; i < lines.length && /^\s*([-*+]|\d+[.)])\s/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
        out.push(h(ordered ? 'ol' : 'ul', {}, items.map((x) => h('li', {}, inline(x)))));
      } else {
        const para = [];
        for (; i < lines.length && lines[i].trim() && !(para.length && isBlockStart(lines[i])); i++) para.push(lines[i].trim());
        out.push(h('p', {}, inline(para.join('\n'))));
      }
    }
    return out;
  }

  // ---- the mode switch ----

  const modes = h('div', { className: 'compose-modes', role: 'tablist', 'aria-label': t('What are you writing?') });
  // POLL IS NOT A MODE OF ITS OWN: it is written in the note's editor. But it has a draft of
  // its own beside the note's (compose.js keeps it in the poll slot), so choosing Poll moves
  // the editor to the poll's draft and choosing Note moves it back, each kept as it was.
  const MODE_LIST = [['note', t('Note')], ['poll', t('Poll')], ['article', t('Article')], ['recipe', t('Recipe')]];
  const modeBtns = {};
  for (const [id, label] of MODE_LIST) {
    modeBtns[id] = h('button', { type: 'button', className: 'compose-mode', role: 'tab', onclick: () => chooseTab(id) }, [
      mark(id), h('span', { textContent: label }),
    ]);
    modes.append(modeBtns[id]);
  }
  // THE ARROW KEYS MOVE ALONG THE TABS, as a tab list does: one Tab stop for the row, Left and
  // Right (mirrored in a right-to-left language), Home and End. They move the focus only;
  // Enter or Space opens one.
  modes.addEventListener('keydown', (e) => {
    const btns = MODE_LIST.map(([id]) => modeBtns[id]);
    const at = btns.indexOf(document.activeElement);
    if (at < 0) return;
    const rtl = getComputedStyle(modes).direction === 'rtl';
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
    let to = null;
    if (step) to = (at + step + btns.length) % btns.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = btns.length - 1;
    if (to === null) return;
    e.preventDefault();
    btns.forEach((b, i) => { b.tabIndex = i === to ? 0 : -1; });
    btns[to].focus();
  });

  // ---- the article form ----
  //
  // AN ARTICLE IS NOT A LONG NOTE. It has its own body, its own draft and its own publish;
  // nothing typed as a note appears here, and nothing written here reaches the note. The
  // note's editor is hidden while this tab is up, untouched, so switching back finds it
  // exactly as it was.

  const art = state.article;
  const artTitle = h('input', { type: 'text', className: 'lf-title', placeholder: t('Title'), 'aria-label': t('Title'), maxLength: 300 });
  artTitle.addEventListener('input', () => { art.title = artTitle.value; });
  const artSummary = h('textarea', { className: 'lf-summary', rows: 2, placeholder: t('A sentence or two that readers see before they open it') });
  artSummary.addEventListener('input', () => { art.summary = artSummary.value; });
  const artTopics = chipInput(art.topics, t('Add a topic'));
  const artCover = imagePicker(art.cover, { max: 1, cover: true, labelText: t('Add a cover image'), sub: t('Shown at the top of the article and in link previews') });
  const artBody = h('textarea', { className: 'lf-body', placeholder: t('Write your article. Markdown works: **bold**, ## headings, > quotes.'), 'aria-label': t('Article'), dir: 'auto' });
  artBody.addEventListener('input', () => { art.body = artBody.value; });
  markdownField(artBody, { onImages: (files, a, b) => uploadIntoBody(files, a, b) });
  artTitle.dir = 'auto';

  // The formatting toolbar: each button wraps or prefixes the selection with markdown, so the
  // body stays plain markdown and Preview shows the result. execCommand keeps the field's own
  // undo, so one undo takes back one button.
  const TOOLS = [
    ['bold', t('Bold'), '**', '**'],
    ['italic', t('Italic'), '_', '_'],
    ['heading', t('Heading'), '## ', '', true],
    ['link', t('Link'), '[', '](https://)'],
    ['quote', t('Quote'), '> ', '', true],
    ['list', t('Bulleted list'), '- ', '', true],
    ['olist', t('Numbered list'), '1. ', '', true],
    ['code', t('Code'), '`', '`'],
    ['image', t('Image'), null, null],
  ];
  const toolbar = h('div', { className: 'lf-toolbar', role: 'toolbar', 'aria-label': t('Formatting') });
  const bodyErr = h('p', { className: 'error lf-img-err' });
  const bodyFile = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, className: 'lf-body-file' });
  // PICTURES IN THE BODY, AS GITHUB TAKES THEM: pasted, dropped or chosen with the Image
  // button, each puts `![Uploading name…]()` where it landed, on a line of its own, and the
  // upload swaps it for `![](link)`. A failed one takes its placeholder away and says why. Then
  // the description row the note composer uses opens under the body, and what is typed there
  // goes between the brackets, which is the picture's alt text; it can be written there by
  // hand too. A selection the Image button was pressed over becomes the description.
  let bodySel = [0, 0];
  let uploadSerial = 0;
  let altRow = null;
  const escapeRe = (u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Replaced in place without moving the caret or taking focus: the person may be typing on.
  function replaceInBody(from, len, text) {
    artBody.setRangeText(text, from, from + len, 'preserve');
    artBody.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function imageAt(url) {
    const m = new RegExp('!\\[([^\\]\\n]*)\\]\\(' + escapeRe(url) + '\\)').exec(artBody.value);
    return m ? { index: m.index, alt: m[1] } : null;
  }
  function setBodyAlt(url, value) {
    const at = imageAt(url);
    if (!at) return;
    const alt = SC.capAltText(SC.normalizeAltBreaks(value || '')).replace(/[\[\]\n]/g, ' ').trim();
    replaceInBody(at.index + 2, at.alt.length, alt);
  }
  function closeBodyAlt() { if (altRow) { if (altRow.flushPending) altRow.flushPending(); altRow.remove(); altRow = null; } }
  function openBodyAlt(url) {
    closeBodyAlt();
    const at = imageAt(url);
    if (!at) return;
    altRow = SC.buildAltEditorRow({
      url, isVideo: false, alt: at.alt, count: 1,
      onChange: (v) => setBodyAlt(url, v),
      onSave: (v) => { setBodyAlt(url, v); closeBodyAlt(); },
    });
    artBody.after(altRow);
  }
  async function uploadIntoBody(files, from, to) {
    bodyErr.textContent = '';
    const btn = toolbar.querySelector('.lf-tool-image');
    btn.disabled = true; btn.classList.add('is-uploading');
    // Every placeholder first, in order, in one step of undo; then each upload swaps its own.
    const chosen = artBody.value.slice(from, to).replace(/[\[\]\n]/g, ' ').trim();
    const tokens = files.map((f) => '![' + t('Uploading {{name}}…', { name: (f.name || 'image').replace(/[\[\]\n]/g, ' ') }) + '](#upload-' + (++uploadSerial) + ')');
    // Each picture a paragraph of its own: a blank line before it (unless it opens the body)
    // and after it, counting the line breaks already there. A single break between text and a
    // picture keeps them one paragraph, and a reader draws the picture inline with line
    // spacing around it. The trailing blank line also puts what is typed next in a new one.
    const breaks = (run) => (run.match(/^\n*/) || [''])[0].length;
    const before = artBody.value.slice(0, from);
    const lead = before ? '\n'.repeat(Math.max(0, 2 - breaks([...before].reverse().join('')))) : '';
    const tail = '\n'.repeat(Math.max(0, 2 - breaks(artBody.value.slice(to))));
    insertAt(artBody, from, to, lead + tokens.join('\n\n') + tail);
    let lastUrl = null;
    for (let i = 0; i < files.length; i++) {
      const token = tokens[i];
      try {
        const url = await window.SidecarComposeUpload(files[i]);
        const where = artBody.value.indexOf(token);
        if (where >= 0) replaceInBody(where, token.length, '![' + (i === 0 ? chosen : '') + '](' + url + ')');
        lastUrl = url;
      } catch (e) {
        const where = artBody.value.indexOf(token);
        // With the line breaks on both sides of it: text on both sides keeps a paragraph break
        // between, and at either end of the body nothing is left.
        if (where >= 0) {
          const v = artBody.value;
          const a = breaks([...v.slice(0, where)].reverse().join(''));
          const z = breaks(v.slice(where + token.length));
          const between = where - a > 0 && where + token.length + z < v.length;
          replaceInBody(where - a, a + token.length + z, between ? '\n\n' : '');
        }
        bodyErr.replaceChildren(...SC.uploadErrorParts(e));
      }
    }
    btn.disabled = false; btn.classList.remove('is-uploading');
    if (lastUrl) openBodyAlt(lastUrl);
  }
  bodyFile.addEventListener('change', () => {
    const files = [...(bodyFile.files || [])];
    bodyFile.value = '';
    if (files.length) uploadIntoBody(files, bodySel[0], bodySel[1]);
  });
  for (const [name, label, before, after, lineStart] of TOOLS) {
    toolbar.append(h('button', {
      type: 'button', className: 'lf-tool lf-tool-' + name, title: label, 'aria-label': label,
      onmousedown: (e) => e.preventDefault(),
      onclick: () => {
        if (before == null) { bodySel = [artBody.selectionStart, artBody.selectionEnd]; bodyFile.click(); return; }
        artBody.focus();
        const { selectionStart: a, selectionEnd: b, value } = artBody;
        // A line mark goes at the start of a line: a newline first when the caret is mid-line.
        const lead = lineStart && a > 0 && value[a - 1] !== '\n' ? '\n' : '';
        document.execCommand('insertText', false, lead + before + value.slice(a, b) + after);
        art.body = artBody.value;
      },
    }, [mark(name)]));
  }

  // WRITE | PREVIEW FOR THE WHOLE ARTICLE, as the recipe has: Preview is the review window's
  // drawing of it (title, cover, summary, topics and the body), so it shows the article as a
  // reader will see it. Each picture in the body carries + ALT there, which opens its
  // description row back in Write.
  const artPreview = h('div', { className: 'lf-preview lf-md lf-article-preview hidden' });
  const writeTab = h('button', { type: 'button', className: 'compose-tab active', textContent: t('Write') });
  const previewTab = h('button', { type: 'button', className: 'compose-tab', textContent: t('Preview') });
  let artPreviewing = false;
  function paintArticlePreview() {
    if (!artPreviewing) return;
    const hasWork = !!(art.title.trim() || art.summary.trim() || art.cover.length || art.body.trim());
    if (!hasWork) { artPreview.replaceChildren(h('p', { className: 'hint', textContent: t('Nothing to preview yet.') })); return; }
    artPreview.replaceChildren(...reviewNode('article').childNodes);
    const imgs = [...artPreview.querySelectorAll('img')];
    // The cover is the review's first picture; its description lives in the cover picker.
    if (art.cover[0] && imgs[0] && imgs[0].getAttribute('src') === art.cover[0].url) {
      withAltChip(imgs.shift(), () => { showArticleTab(false); artCover.openAlt(0); });
    }
    imgs.forEach((img) => {
      const url = img.getAttribute('src');
      if (!url || !imageAt(url)) return;
      withAltChip(img, () => { showArticleTab(false); openBodyAlt(url); });
    });
  }
  function showArticleTab(preview) {
    artPreviewing = preview;
    writeTab.classList.toggle('active', !preview);
    previewTab.classList.toggle('active', preview);
    artWrite.classList.toggle('hidden', preview);
    artPreview.classList.toggle('hidden', !preview);
    if (preview) closeBodyAlt();
    paintArticlePreview();
  }
  writeTab.addEventListener('click', () => { showArticleTab(false); artBody.focus(); });
  previewTab.addEventListener('click', () => showArticleTab(true));

  const artWrite = h('div', { className: 'lf-recipe-write lf-article-write' }, [
    artTitle,
    artCover.el,
    field(t('Summary'), artSummary),
    field(t('Topics'), artTopics.el),
    h('div', { className: 'lf-group' }, [toolbar, artBody, bodyErr, bodyFile]),
  ]);
  const articleForm = h('section', { className: 'lf-form lf-article hidden' }, [
    h('div', { className: 'compose-tabs lf-body-tabs' }, [writeTab, previewTab]),
    artWrite, artPreview,
  ]);

  // ---- the recipe form ----

  const rec = state.recipe;
  const recTitle = h('input', { type: 'text', className: 'lf-title', placeholder: t('Recipe name'), 'aria-label': t('Recipe name'), maxLength: 300, dir: 'auto' });
  recTitle.addEventListener('input', () => { rec.title = recTitle.value; });
  const recSummary = h('textarea', { className: 'lf-summary', rows: 2, placeholder: t('What makes this one worth making'), dir: 'auto' });
  recSummary.addEventListener('input', () => { rec.summary = recSummary.value; });
  const recNotes = h('textarea', { className: 'lf-notes', rows: 3, placeholder: t('Tips, substitutions, the story behind it'), dir: 'auto' });
  recNotes.addEventListener('input', () => { rec.notes = recNotes.value; });
  markdownField(recNotes, { headings: false });
  const details = {};
  const detail = (key, label, ph) => {
    const input = h('input', { type: 'text', placeholder: ph, dir: 'auto' });
    input.addEventListener('input', () => { rec[key] = input.value; });
    // A TIME THAT IS ONLY A NUMBER IS MINUTES. Left as "15", the recipe page showed a bare 15;
    // Zap Cooking's planner already reads a bare number as minutes, so the field says so too,
    // where it can be seen and changed. Anything with words ("1 hr", "overnight") is kept.
    if (key === 'prep' || key === 'cook') {
      input.addEventListener('change', () => {
        const m = /^\s*(\d+(?:[.,]\d+)?)\s*$/.exec(input.value);
        if (!m || !(parseFloat(m[1].replace(',', '.')) > 0)) return;
        input.value = m[1] + ' min';
        rec[key] = input.value;
        document.dispatchEvent(new CustomEvent('lf-change'));
      });
    }
    details[key] = input;
    return field(label, input);
  };
  const recIngredients = listEditor(rec.ingredients, { numbered: false, placeholder: t('2 cups flour'), addLabel: t('Add'), label: t('Ingredients') });
  const recDirections = listEditor(rec.directions, { numbered: true, placeholder: t('Describe the next step'), addLabel: t('Add'), label: t('Directions') });
  const recCategories = chipInput(rec.categories, t('Add a category'), recipeCategoryHints, canonicalCategory, categoryShown);
  const recSource = h('input', { type: 'url', placeholder: 'https://' });
  recSource.addEventListener('input', () => { rec.source = recSource.value; });
  const recPhotos = imagePicker(rec.photos, {
    max: 10, cover: true, labelText: t('Add photos'),
    coverLabel: t('Add a cover photo'), sub: t('Shown at the top of the recipe and in link previews'),
    moreLabel: t('Add more photos'), moreSub: t('Up to ten in all. Tap one to make it the cover.'),
  });
  const recSourceBox = disclosure(t('Add a source'), field(t('Source'), recSource, t('Where the recipe came from, if it is not yours')), () => !!rec.source);

  // Credit where the format comes from. The wordmark follows the theme: the dark cut on a
  // light theme, the light cut on a dark one.
  const zcLogo = h('img', { className: 'lf-zc-logo', alt: 'Zap Cooking', draggable: false });
  const zcBadge = h('a', {
    className: 'lf-zc-badge', href: 'https://zap.cooking', target: '_blank', rel: 'noopener noreferrer',
    title: t('Recipes published here open on Zap Cooking'),
  }, [h('span', { textContent: t('Powered by') }), zcLogo]);

  // Write | Preview for the whole recipe, as the article has for its body. Preview is the
  // review window's drawing of it, from the same markdown that is published, so what shows
  // here is what Zap Cooking will be sent.
  const recPreview = h('div', { className: 'lf-preview lf-md lf-recipe-preview hidden' });
  const recWriteTab = h('button', { type: 'button', className: 'compose-tab active', textContent: t('Write') });
  const recPreviewTab = h('button', { type: 'button', className: 'compose-tab', textContent: t('Preview') });
  let recPreviewing = false;
  function paintRecipePreview() {
    if (!recPreviewing) return;
    const node = reviewNode('recipe');
    const hasWork = !!(rec.title.trim() || rec.summary.trim() || rec.photos.length || EV.recipeMarkdown(rec).trim());
    recPreview.replaceChildren(...(hasWork ? [...node.childNodes] : [h('p', { className: 'hint', textContent: t('Nothing to preview yet.') })]));
    const cover = recPreview.querySelector('img');
    if (cover && rec.photos[0] && cover.getAttribute('src') === rec.photos[0].url) {
      withAltChip(cover, () => { showRecipeTab(false); recPhotos.openAlt(0); });
    }
  }
  function showRecipeTab(preview) {
    recPreviewing = preview;
    recWriteTab.classList.toggle('active', !preview);
    recPreviewTab.classList.toggle('active', preview);
    recWrite.classList.toggle('hidden', preview);
    recPreview.classList.toggle('hidden', !preview);
    paintRecipePreview();
  }
  recWriteTab.addEventListener('click', () => { showRecipeTab(false); recTitle.focus(); });
  recPreviewTab.addEventListener('click', () => showRecipeTab(true));

  const recWrite = h('div', { className: 'lf-recipe-write' }, [
    recTitle,
    recPhotos.el,
    field(t('Summary'), recSummary),
    h('div', { className: 'lf-details' }, [
      detail('prep', t('Prep time'), t('20 min')),
      detail('cook', t('Cook time'), t('1 hr')),
      detail('servings', t('Servings'), '6'),
    ]),
    h('div', { className: 'lf-group' }, [h('span', { className: 'lf-label', textContent: t('Ingredients') }), recIngredients.el]),
    h('div', { className: 'lf-group' }, [h('span', { className: 'lf-label', textContent: t('Directions') }), recDirections.el]),
    field(t('Chef’s notes'), recNotes),
    field(t('Categories'), recCategories.el),
    recSourceBox.el,
  ]);
  const recipeForm = h('section', { className: 'lf-form lf-recipe hidden' }, [
    // The credit rides at the far end of the recipe's own Write | Preview row, which has room
    // for it in every language; the mode switch's row did not once its labels were translated.
    h('div', { className: 'compose-tabs lf-body-tabs lf-recipe-tabs' }, [recWriteTab, recPreviewTab, zcBadge]),
    recWrite, recPreview,
  ]);

  // ---- footer: reading length for an article, what is still missing for a recipe ----

  const lengthNote = h('span', { className: 'lf-length hidden' });
  const missingNote = h('span', { className: 'lf-missing hidden' });
  const savedNote = h('span', { className: 'compose-saved lf-saved', role: 'status', 'aria-live': 'polite' });
  function words(text) { return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length; }
  function updateLength() {
    const n = words(art.body || '');
    const min = Math.max(1, Math.round(n / 230));
    lengthNote.textContent = tn('{{count}} word', '{{count}} words', n) + ' · ' + tn('{{count}} min read', '{{count}} min read', min);
  }

  function articleMissing() {
    return [
      !art.title.trim() && t('a title'),
      !art.body.trim() && t('the article itself'),
    ].filter(Boolean);
  }

  function recipeMissing() {
    return [
      !rec.title.trim() && t('a name'),
      !rec.photos.length && t('a photo'),
      !rec.ingredients.length && t('ingredients'),
      !rec.directions.length && t('directions'),
      !rec.categories.length && t('a category'),
    ].filter(Boolean);
  }

  // A list in the panel's language: "a title, a photo and a category", with its own commas
  // and "and" (、 in Japanese, ، in Arabic). An English ", " read wrong in most of them.
  function listOf(items) {
    try { return new Intl.ListFormat(window.SidecarI18n.lang, { type: 'conjunction' }).format(items); }
    catch (_) { return items.join(', '); }
  }

  // What an article still needs before it can go out, and what a recipe needs before Zap
  // Cooking would list it, beside Review.
  function updateMissing() {
    const miss = state.mode === 'recipe' ? recipeMissing() : state.mode === 'article' ? articleMissing()
      : [];
    missingNote.classList.toggle('hidden', !miss.length);
    missingNote.textContent = miss.length ? t('Still needed: {{list}}', { list: listOf(miss) }) : '';
    if (typeof labelPost === 'function') labelPost();
  }

  // ---- drafts: one per kind, per account, apart from the note's ----
  //
  // Their own encrypted store ('longform' in background.js), never the note's draft slots:
  // those are listed under Saved drafts and opened into the note editor, which is exactly the
  // mixing this keeps out. Shape: { [pubkey]: { article: {...}, recipe: {...} } }.

  let owner = null; // the account the forms on screen belong to
  let saveTimer = null;
  let loading = false;
  function call(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          if (resp && resp.error) return reject(new Error(resp.error));
          resolve(resp && 'result' in resp ? resp.result : resp);
        });
      } catch (e) { reject(e); }
    });
  }
  const hasArticle = () => !!(art.title.trim() || art.summary.trim() || art.body.trim() || art.cover.length || art.topics.length);
  const hasRecipe = () => !!(rec.title.trim() || rec.summary.trim() || rec.notes.trim() || rec.prep || rec.cook || rec.servings || rec.source
    || rec.photos.length || rec.ingredients.length || rec.directions.length || rec.categories.length);
  const plain = (o) => JSON.parse(JSON.stringify(o));
  function markDrafts() {
    modeBtns.article.classList.toggle('has-draft', hasArticle());
    modeBtns.recipe.classList.toggle('has-draft', hasRecipe());
  }
  async function persist() {
    if (!owner) return;
    const all = await call({ type: 'SIDECAR_SECRET_GET', store: 'longform' });
    // A failed read (locked, unreadable) is not an empty store: writing would replace the
    // other accounts' drafts with this one.
    if (!all || typeof all !== 'object') throw new Error('unreadable');
    const mine = {};
    const now = Date.now();
    // A draft's time moves only when it is the one being written.
    if (hasArticle()) mine.article = { ...plain(art), savedAt: state.mode === 'article' || !art.savedAt ? (art.savedAt = now) : art.savedAt };
    if (hasRecipe()) mine.recipe = { ...plain(rec), savedAt: state.mode === 'recipe' || !rec.savedAt ? (rec.savedAt = now) : rec.savedAt };
    // A thread's draft from a build that wrote threads (dev/threads) is kept as it was, for
    // a build that writes them again: this one neither shows it nor drops it.
    if (all[owner] && all[owner].thread) mine.thread = all[owner].thread;
    if (Object.keys(mine).length) all[owner] = mine; else delete all[owner];
    await call({ type: 'SIDECAR_SECRET_SET', store: 'longform', value: all });
  }
  function paintSaved(st, locked) { SC.paintSavedState(savedNote, st, !!locked); }
  function scheduleSave() {
    markDrafts();
    if (loading || !owner) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persist().then(
        () => {
          paintSaved(state.mode === 'article' ? (hasArticle() ? 'saved' : '') : (hasRecipe() ? 'saved' : ''));
          if (window.SidecarComposeDrafts) window.SidecarComposeDrafts.repaint();
        },
        (e) => { console.warn('Sidecar: article/recipe draft not saved:', e && e.message); paintSaved('failed', /locked|unreadable/i.test(String(e && e.message))); },
      );
    }, 500);
  }
  async function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    try { await persist(); } catch (_) {}
  }
  // Arrays are filled in place: the list editors hold them by reference.
  function fill(target, saved, blank) {
    for (const [k, v] of Object.entries(blank)) {
      const val = saved && k in saved ? saved[k] : v;
      if (Array.isArray(v)) target[k].splice(0, target[k].length, ...(Array.isArray(val) ? val : []));
      else target[k] = typeof val === 'string' ? val : v;
    }
  }
  const BLANK_ARTICLE = { title: '', summary: '', cover: [], topics: [], body: '' };
  const BLANK_RECIPE = { title: '', summary: '', photos: [], notes: '', prep: '', cook: '', servings: '', ingredients: [], directions: [], categories: [], source: '' };
  // When each was last written, for its row in Saved drafts. Not part of the draft itself.
  Object.defineProperty(art, 'savedAt', { value: 0, writable: true, enumerable: false });
  Object.defineProperty(rec, 'savedAt', { value: 0, writable: true, enumerable: false });
  function paintForms() {
    artTitle.value = art.title; artSummary.value = art.summary; artBody.value = art.body;
    recTitle.value = rec.title; recSummary.value = rec.summary; recNotes.value = rec.notes; recSource.value = rec.source;
    for (const k of ['prep', 'cook', 'servings']) details[k].value = rec[k];
    recPhotos.draw(); artCover.draw(); recIngredients.draw(); recDirections.draw(); recCategories.draw(); artTopics.draw();
    recSourceBox.sync();
    updateMissing(); updateLength(); markDrafts();
    paintRecipePreview();
    paintArticlePreview();
  }
  async function loadFor(pubkey) {
    if (pubkey === owner) return;
    await flush(); // the forms on screen belong to the account that was active when they were typed
    owner = pubkey;
    loading = true;
    let mine = null;
    try { const all = await call({ type: 'SIDECAR_SECRET_GET', store: 'longform' }); mine = all && all[pubkey]; } catch (_) {}
    fill(art, mine && mine.article, BLANK_ARTICLE);
    fill(rec, mine && mine.recipe, BLANK_RECIPE);
    art.savedAt = (mine && mine.article && mine.article.savedAt) || 0;
    rec.savedAt = (mine && mine.recipe && mine.recipe.savedAt) || 0;
    paintForms();
    paintSaved('');
    loading = false;
    // Opened from the panel's Saved drafts on an article or a recipe: that tab first. The
    // marker leaves the address so a reload comes back to wherever the person went next.
    // And A RELOAD COMES BACK TO THE TAB IT LEFT (a theme change reloads the page): the
    // tab was kept for this browser tab only, so a new composer tab still opens on Note.
    const hash = location.hash.slice(1);
    const want = hash || resumeMode;
    resumeMode = '';
    if (want === 'article' || want === 'recipe') {
      if (hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} }
      if (!(P() && P().isReply && P().isReply())) setMode(want);
    }
  }
  // The same, to a tab that is already open. And A NOTE SENT FROM THE PANEL (Expand on a
  // note, a quote tapped there) opens in the Note tab: going back to the editor alone left
  // whichever tab was last up. From Sidecar's own pages only.
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || !sender || sender.id !== chrome.runtime.id || !String(sender.url || '').startsWith(chrome.runtime.getURL(''))) return;
    if (msg.type === 'SIDECAR_COMPOSE_MODE' && ['article', 'recipe', 'note'].includes(msg.mode)) setMode(msg.mode);
    else if (msg.type === 'SIDECAR_COMPOSE_MODE' && msg.mode === 'poll') chooseTab('poll');
    else if ((msg.type === 'SIDECAR_COMPOSE_OPEN' && msg.showDrafts !== true) || msg.type === 'SIDECAR_COMPOSE_QUOTE') setMode('note', { keepList: true });
  });
  // And a note picked from Saved drafts, here or on the relays: every row outside the
  // articles-and-recipes section is a note. The list is left for the pick to close.
  $('compose-drafts-pane').addEventListener('click', (e) => {
    const row = e.target.closest('.saved-draft-open');
    if (row && !row.closest('.lf-saved-drafts')) setMode('note', { keepList: true });
  }, true);
  document.addEventListener('sidecar-account', (e) => { loadFor(e.detail); });
  // The note's editor moved to another draft (compose.js): the poll's, or away from it.
  document.addEventListener('sidecar-slot', () => paintTabs());

  // ---- in Saved drafts ----
  //
  // One article and one recipe per account, listed under the note drafts in the same rows,
  // each opening its own tab. "Waiting" leaves out the one on screen, as the note list
  // leaves out the note being written; `all` counts both, for whether the list is empty.
  function waitingCount(all) {
    return (hasArticle() && (all || state.mode !== 'article') ? 1 : 0) + (hasRecipe() && (all || state.mode !== 'recipe') ? 1 : 0);
  }
  function draftsSection() {
    const mine = {};
    if (hasArticle()) mine.article = { ...plain(art), savedAt: art.savedAt };
    if (hasRecipe()) mine.recipe = { ...plain(rec), savedAt: rec.savedAt };
    return SC.buildLongformDraftList(SC.longformDraftItems(mine, state.mode), {
      // The open one can go too: onDelete clears the form itself, so nothing writes it back.
      discard: true,
      onOpen: (kind) => { window.SidecarComposeDrafts.back(); setMode(kind); },
      onDelete: (kind) => {
        const obj = kind === 'article' ? art : rec;
        fill(obj, null, kind === 'article' ? BLANK_ARTICLE : BLANK_RECIPE);
        obj.savedAt = 0;
        paintForms();
        persist().catch(() => {}).then(() => window.SidecarComposeDrafts.repaint());
      },
    });
  }

  window.addEventListener('pagehide', () => { flush(); });
  for (const form of [articleForm, recipeForm]) form.addEventListener('input', () => { updateLength(); updateMissing(); scheduleSave(); });
  document.addEventListener('lf-change', () => { updateMissing(); scheduleSave(); });

  // ---- publishing ----
  //
  // The note composer writes "Post" on its button as it goes; an article or a recipe
  // publishes. In those tabs the button is this file's: it is on only when the draft is
  // complete, and a click on it is taken here, before the note's own handler could post
  // whatever is sitting in the hidden note editor.
  const post = $('compose-post');
  const EV = window.SidecarLongformEvents;
  const P = () => window.SidecarComposePublish;
  let publishing = false;
  const ready = () => (state.mode === 'article' ? !articleMissing().length : state.mode === 'recipe' ? !recipeMissing().length
    : false);
  function labelPost() {
    if (state.mode === 'note') return;
    // "Review", not "Publish": the button opens the review, and Publish is pressed there.
    const want = publishing ? t('Publishing…') : t('Review');
    if (post.textContent !== want) post.textContent = want;
    const off = publishing || !ready() || !P() || P().busy();
    if (post.disabled !== off) post.disabled = off;
  }
  new MutationObserver(() => { labelPost(); paintTabs(); }).observe(post, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  post.addEventListener('click', (e) => {
    if (state.mode === 'note') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (!post.disabled) publishCurrent();
  }, true);

  // The question when the address is already one of the account's articles: publishing there
  // would replace it, which is never done without asking. Resolves 'replace', 'new' or null.
  const confirmRow = h('div', { className: 'lf-confirm hidden', role: 'alertdialog' });
  function askAddress(kind, existingTitle) {
    return new Promise((resolve) => {
      const done = (v) => { confirmRow.classList.add('hidden'); confirmRow.replaceChildren(); resolve(v); };
      confirmRow.replaceChildren(
        h('p', { className: 'confirm-msg', textContent: kind === 'recipe'
          ? t('You already published a recipe at this address: “{{title}}”. Publishing replaces it.', { title: existingTitle })
          : t('You already published an article at this address: “{{title}}”. Publishing replaces it.', { title: existingTitle }) }),
        h('div', { className: 'lf-confirm-actions' }, [
          h('button', { type: 'button', className: 'danger', textContent: t('Replace it'), onclick: () => done('replace') }),
          h('button', { type: 'button', className: 'secondary', textContent: t('Publish as a new one'), onclick: () => done('new') }),
          h('button', { type: 'button', className: 'ghost', textContent: t('Cancel'), onclick: () => done(null) }),
        ]),
      );
      confirmRow.classList.remove('hidden');
      confirmRow.querySelector('button').focus();
    });
  }

  // A picture in Preview, with the composer's ALT chip on it: ✓ when it has a description.
  function withAltChip(img, onclick) {
    const wrap = h('span', { className: 'lf-preview-img' });
    img.replaceWith(wrap);
    const alt = img.getAttribute('alt') || '';
    wrap.append(img, h('button', {
      type: 'button', className: 'compose-thumb-alt' + (alt ? ' has-alt' : ''),
      title: alt ? t('Edit the image description') : t('Add a description'),
      textContent: alt ? '✓ ALT' : '+ ALT', onclick,
    }));
  }

  // What the review window shows: the piece as a reader would see it.
  function reviewNode(kind) {
    const obj = kind === 'article' ? art : rec;
    const pic = kind === 'article' ? art.cover[0] : rec.photos[0];
    return h('div', { className: 'countdown-preview lf-md lf-review' }, [
      h('h1', { textContent: obj.title.trim(), dir: 'auto' }),
      pic ? h('img', { src: pic.url, alt: pic.alt || '', referrerPolicy: 'no-referrer' }) : null,
      obj.summary.trim() ? h('p', { className: 'lf-review-summary', textContent: obj.summary.trim(), dir: 'auto' }) : null,
      // A recipe's categories, as Zap Cooking lists them on the recipe's page.
      kind === 'recipe' && rec.categories.length ? h('p', { className: 'lf-review-tags' }, rec.categories.map((c) => h('span', { className: 'lf-review-tag', textContent: CATEGORY_EMOJI[c] ? categoryShown(c) : '#' + categoryLabel(c) }))) : null,
      // An article's topics, as hashtags, the way they go out (EV.tagSlug).
      kind === 'article' && art.topics.length ? h('p', { className: 'lf-review-tags' }, [...new Set(art.topics.map(EV.tagSlug).filter(Boolean))].map((x) => h('span', { className: 'lf-review-tag', textContent: '#' + x }))) : null,
      ...renderMarkdown(kind === 'article' ? art.body : EV.recipeMarkdown(rec)),
    ]);
  }

  const titleOf = (ev) => ((ev.tags || []).find((x) => x[0] === 'title') || [])[1] || '';
  async function publishCurrent() {
    const kind = state.mode;
    const api = P();
    if (publishing || !api || !ready() || (kind !== 'article' && kind !== 'recipe')) return;
    const errEl = $('compose-err');
    errEl.textContent = '';
    publishing = true;
    labelPost();
    try {
      await flush();
      // THE REVIEW FIRST, every time: the whole piece as it will read, then Publish or Back
      // to editor. Back leaves the form as it was.
      const go = await api.review({
        title: kind === 'article' ? t('Review your article') : t('Review your recipe'),
        preview: reviewNode(kind),
      });
      if (!go) return;
      const now = Math.floor(Date.now() / 1000);
      const obj = kind === 'article' ? art : rec;
      let d = kind === 'article' ? EV.articleIdentifier(art.title, now) : EV.recipeIdentifier(rec.title, now);
      // NEVER A SILENT REPLACE. A 30023 at an address the account already used replaces that
      // article everywhere, so look first, and ask.
      const found = await api.findOwn(d);
      if (found.length) {
        const newest = found.reduce((a, b) => (b.created_at > a.created_at ? b : a));
        const choice = await askAddress(kind, titleOf(newest) || d);
        if (!choice) return;
        if (choice === 'new') {
          const taken = [d];
          for (let n = 2; n < 50; n++) {
            const next = EV.nextIdentifier(d, taken);
            if (!(await api.findOwn(next)).length) { d = next; break; }
            taken.push(next);
          }
        }
      }
      const settings = (await api.settings()) || {};
      const NT = window.NostrTools;
      const body = kind === 'article' ? SC.noteBodyTags(SC.linkBareRefs(art.body, NT), NT, []) : { p: [], q: [] };
      const pics = kind === 'article' ? art.cover : rec.photos;
      const extra = [
        ...(settings.showClientTag === false ? [] : [['client', 'Sidecar']]),
        ...body.p,
        ...SC.imetaTagsForMedia(pics),
      ];
      const template = kind === 'article'
        ? EV.articleTemplate(art, { now, d, extra })
        : EV.recipeTemplate(rec, { now, d, extra });
      const { signed, report } = await api.send(template);
      // Out: the draft goes, as a note's does once a relay has it.
      fill(obj, null, kind === 'article' ? BLANK_ARTICLE : BLANK_RECIPE);
      obj.savedAt = 0;
      await persist().catch(() => {});
      const naddr = NT.nip19.naddrEncode({ kind: EV.KIND, pubkey: signed.pubkey, identifier: d, relays: report.accepted.slice(0, 3) });
      const links = [];
      if (kind === 'recipe') links.push({ label: t('View on Zap Cooking'), href: 'https://zap.cooking/r/' + naddr, primary: true });
      links.push({ label: t('Open in {{client}}', { client: 'Jumble' }), href: 'https://jumble.social/notes/' + naddr, primary: kind === 'article' });
      await api.showPosted(signed, report, {
        title: kind === 'article' ? t('Your article is live.') : t('Your recipe is live.'),
        links,
      });
    } catch (e) {
      errEl.textContent = (e && e.message) || t('Could not publish');
    } finally {
      publishing = false;
      if (post.isConnected) labelPost();
    }
  }

  // ---- choosing a tab ----
  //
  // Poll and Note are the same editor on two drafts, so moving between them moves the editor
  // from one draft to the other, nothing asked and nothing lost. Poll, Article and Recipe
  // are not replies: while this tab answers a note, they say so instead of opening.
  function chooseTab(id) {
    const api = P();
    if (modeBtns[id].getAttribute('aria-disabled') === 'true') return;
    if (id === 'poll' || id === 'note') {
      setMode('note');
      if (api && api.inPoll() !== (id === 'poll')) Promise.resolve(api.openPoll(id === 'poll')).then(paintTabs, paintTabs);
      return;
    }
    setMode(id);
  }
  function paintTabs() {
    const api = P();
    const lit = state.mode === 'note' && api && api.inPoll() ? 'poll' : state.mode;
    const reply = !!(api && api.isReply());
    for (const [id] of MODE_LIST) {
      modeBtns[id].classList.toggle('active', id === lit);
      modeBtns[id].setAttribute('aria-selected', String(id === lit));
      modeBtns[id].tabIndex = id === lit ? 0 : -1;
      const off = reply && id !== 'note';
      modeBtns[id].setAttribute('aria-disabled', String(off));
      modeBtns[id].classList.toggle('is-off', off);
      modeBtns[id].title = off ? t('Not available in a reply') : '';
    }
  }

  // ---- switching ----

  // The tab on screen, kept for this browser tab so a reload reopens it. Read before the
  // mount below puts the page on Note.
  const MODE_KEY = 'sidecar-compose-mode';
  let resumeMode = '';
  try { resumeMode = sessionStorage.getItem(MODE_KEY) || ''; } catch (_) {}

  let noteDisabled = null;
  function setMode(mode, opts) {
    const was = state.mode;
    // A tab chosen while Saved drafts is up closes the list first: the list belongs to no tab.
    // Not when a pick from the list is what chose it: the pick closes the list itself.
    const pane = $('compose-drafts-pane');
    if (!(opts && opts.keepList) && pane && !pane.classList.contains('hidden') && window.SidecarComposeDrafts) window.SidecarComposeDrafts.back();
    if (was === 'note' && mode !== 'note') noteDisabled = post.disabled;
    state.mode = mode;
    try { sessionStorage.setItem(MODE_KEY, mode); } catch (_) {}
    document.querySelector('.compose-sheet').dataset.mode = mode;
    articleForm.classList.toggle('hidden', mode !== 'article');
    recipeForm.classList.toggle('hidden', mode !== 'recipe');
    lengthNote.classList.toggle('hidden', mode !== 'article');
    savedNote.classList.toggle('hidden', mode === 'note');
    paintSaved(mode === 'article' && hasArticle() ? 'saved' : mode === 'recipe' && hasRecipe() ? 'saved' : '');
    paintTabs();
    updateMissing();
    // Back on the note, its button is the note's again: what the note composer last set.
    if (mode === 'note' && was !== 'note') {
      if (noteDisabled !== null) post.disabled = noteDisabled;
      if (P() && P().repaint) P().repaint();
    }
    if (mode !== 'note') showArticleTab(false);
    labelPost();
    if (was !== mode && !(opts && opts.keepList) && window.SidecarComposeDrafts) window.SidecarComposeDrafts.repaint();
    zcLogo.src = SC.LIGHT_THEMES.has(document.documentElement.getAttribute('data-theme'))
      ? 'icons/zap-cooking-dark.svg' : 'icons/zap-cooking-light.svg';
    updateLength();
  }

  // ---- mount ----

  const tabs = $('compose-tabs');
  tabs.before(h('div', { className: 'lf-mode-row' }, [modes]), articleForm, recipeForm);
  $('compose-count').before(lengthNote, missingNote, savedNote);
  $('compose-err').before(confirmRow);
  setMode('note');

  window.SidecarLongform = { seasonalCategories, matchingCategories, categoryShown, setMode, state, RECIPE_FORMAT, recipeMissing, articleMissing, renderMarkdown, publish: publishCurrent, flush, refresh: paintForms, changed: scheduleSave, waitingCount, draftsSection };
  // Saved drafts may have been drawn while this waited: drawn again, it lists these too.
  if (window.SidecarComposeDrafts && window.SidecarComposeDrafts.repaint) window.SidecarComposeDrafts.repaint();
})();
