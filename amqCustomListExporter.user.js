// ==UserScript==
// @name         AMQ Custom List Exporter
// @namespace    https://github.com/YayaLT/AMQ-Scripts
// @version      1.4
// @description  Adds an export button to each custom lisst in the AMQ song library. Fetches song metadata (HQ/MQ/audio links) from anisongdb and exports as a flat JSON array.
// @author       YayaLT
// @match        https://*.animemusicquiz.com/*
// @icon         https://animemusicsquiz.com/favicon.ico
// @downloadURL  https://github.com/YayaLT/AMQ-Scripts/raw/main/amqCustomListExporter.user.js
// @updateURL    https://github.com/YayaLT/AMQ-Scripts/raw/main/amqCustomListExporter.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Nombre de songs envoyées par requête à anisongdb (max recommandé : 50)
    const ANISONGDB_BATCH_SIZE = 50;

    // ─── Initialisation ──────────────────────────────────────────────────────────

    // Attend que les objets globaux AMQ soient prêts avant d'injecter les boutons
    function waitForAMQ(callback) {
        const interval = setInterval(() => {
            if (typeof customListHandler !== 'undefined'
                && customListHandler?.customListMap?.size > 0
                && typeof libraryCacheHandler !== 'undefined'
                && libraryCacheHandler?.songEntryMap
                && libraryCacheHandler?.animeCache) {
                clearInterval(interval);
                callback();
            }
        }, 500);
    }

    // ─── anisongdb ───────────────────────────────────────────────────────────────

    // Requête ann_song_ids_request — couvre la majorité des cas
    // Retourne un dict { annSongId -> songObject }
    async function fetchByAnnSongIds(annSongIds) {
        const results = {};
        for (let i = 0; i < annSongIds.length; i += ANISONGDB_BATCH_SIZE) {
            const batch = annSongIds.slice(i, i + ANISONGDB_BATCH_SIZE);
            try {
                const response = await fetch('https://anisongdb.com/api/ann_song_ids_request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ann_song_ids: batch })
                });
                if (response.ok) {
                    const data = await response.json();
                    data.forEach(entry => { results[entry.annSongId] = entry; });
                }
            } catch (e) {
                console.error('[AMQ Exporter] ann_song_ids batch error:', e);
            }
        }
        return results;
    }

    // Requête amq_song_ids_request — fallback pour les IDs non trouvés par ann_song_ids_request
    // Dans anisongdb, amqSongId == annSongId AMQ pour certaines chansons
    // Retourne un dict { amqSongId -> songObject }
    async function fetchByAmqSongIds(annSongIds) {
        const results = {};
        for (let i = 0; i < annSongIds.length; i += ANISONGDB_BATCH_SIZE) {
            const batch = annSongIds.slice(i, i + ANISONGDB_BATCH_SIZE);
            try {
                const response = await fetch('https://anisongdb.com/api/amq_song_ids_request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amq_song_ids: batch })
                });
                if (response.ok) {
                    const data = await response.json();
                    data.forEach(entry => { results[entry.amqSongId] = entry; });
                }
            } catch (e) {
                console.error('[AMQ Exporter] amq_song_ids batch error:', e);
            }
        }
        return results;
    }

    // ─── Export ──────────────────────────────────────────────────────────────────

    // Construit une entrée de fallback depuis libraryCacheHandler
    // pour les songs absentes d'anisongdb ou avec des données incomplètes
    function buildFallbackEntry(annSongId) {
        const animeId   = libraryCacheHandler.annSongIdAnnIdMap[annSongId];
        const songEntry = libraryCacheHandler.songEntryMap[annSongId];
        const songMeta  = animeId != null
            ? libraryCacheHandler.animeCache[animeId]?.songMap[annSongId]
            : null;
        const anime     = animeId != null
            ? libraryCacheHandler.animeCache[animeId]
            : null;
        const TYPE_MAP  = { 1: 'OP', 2: 'ED', 3: 'INS' };
        const typeStr   = TYPE_MAP[songMeta?.type] ?? 'UNK';
        const songType  = (songMeta?.number > 0) ? `${typeStr}${songMeta.number}` : typeStr;

        return {
            annSongId,
            songName:    songEntry?.name         ?? null,
            songArtist:  songEntry?.artist?.name ?? null,
            songType,
            animeENName: anime?.mainNames?.EN    ?? null,
            animeJPName: anime?.mainNames?.JA    ?? null,
            HQ:          null,
            MQ:          null,
            audio:       null,
        };
    }

    // Une entrée anisongdb est valide si elle a au moins songName et un lien audio
    function isValidEntry(entry) {
        return entry && (entry.songName || entry.HQ || entry.MQ || entry.audio);
    }

    async function exportList(list, btn) {
        btn.classList.add('elCustomListExportLoading');
        btn.querySelector('i').className = 'fa fa-spinner fa-spin';

        const annSongIds = [...list.songMap.keys()];

        // Étape 1 : requête principale via ann_song_ids_request
        const annMap = await fetchByAnnSongIds(annSongIds);

        // Étape 2 : fallback via amq_song_ids_request pour les IDs manquants ou invalides
        const missingIds = annSongIds.filter(id => !isValidEntry(annMap[id]));
        const amqMap     = missingIds.length > 0
            ? await fetchByAmqSongIds(missingIds)
            : {};

        // Tableau plat dans l'ordre de la liste
        // Priorité : ann -> amq -> fallback libraryCacheHandler
        const songs = annSongIds.map(annSongId => {
            if (isValidEntry(annMap[annSongId]))  return annMap[annSongId];
            if (isValidEntry(amqMap[annSongId]))  return amqMap[annSongId];
            return buildFallbackEntry(annSongId);
        });

        const blob = new Blob([JSON.stringify(songs, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `amq_${list._name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        btn.classList.remove('elCustomListExportLoading');
        btn.querySelector('i').className = 'fa fa-download';
    }

    // ─── UI ──────────────────────────────────────────────────────────────────────

    // Injecte un bouton download dans le container d'options d'une liste
    function injectExportButton(list) {
        const $optionContainer = list.$entry.find('.elCustomListEntryOptionContainer');
        if ($optionContainer.find('.elCustomListExportButton').length > 0) return;

        const $btn = $(`
            <div class="elCustomListEntryOption elCustomListExportButton" title="Download as JSON">
                <i class="fa fa-download" aria-hidden="true"></i>
            </div>
        `);

        $btn.on('click', function (e) {
            e.stopPropagation();
            exportList(list, $btn[0]);
        });

        $optionContainer.find('.elCustomListEntryDeleteButton').before($btn);
    }

    function injectAllButtons() {
        customListHandler.customListMap.forEach((list) => injectExportButton(list));
    }

    // Observe les nouvelles listes créées dynamiquement
    function observeNewLists() {
        const container = document.getElementById('elCustomListEntryContainer');
        if (!container) return;
        const observer = new MutationObserver(() => injectAllButtons());
        observer.observe(container, { childList: true, subtree: true });
    }

    waitForAMQ(() => {
        injectAllButtons();
        observeNewLists();
    });

    // ─── Styles ──────────────────────────────────────────────────────────────────

    const style = document.createElement('style');
    style.textContent = `
        .elCustomListExportButton { color: #aebbd8; cursor: pointer; }
        .elCustomListExportButton:hover { color: #fff; }
        .elCustomListExportLoading { opacity: 0.6; cursor: wait !important; }
    `;
    document.head.appendChild(style);

})();