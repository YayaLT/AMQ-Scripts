// ==UserScript==
// @name         AMQ Custom List Exporter
// @namespace    http://tampermonkey.net/
// @version      10.0
// @description  Adds export button to each custom list in the song library
// @author       you
// @match        https://animemusicquiz.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const ANISONGDB_BATCH_SIZE = 50;

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

    async function fetchAllAnisongdb(annSongIds) {
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
                console.error('anisongdb batch error:', e);
            }
        }
        return results;
    }

    async function exportList(list, btn) {
        btn.classList.add('elCustomListExportLoading');
        btn.querySelector('i').className = 'fa fa-spinner fa-spin';

        const annSongIds = [...list.songMap.keys()];
        const anisongMap = await fetchAllAnisongdb(annSongIds);

        // Tableau plat de chansons, dans l'ordre de la liste
        // Pour les chansons absentes d'anisongdb, on construit une entrée minimale
        const songs = annSongIds.map(id => {
            if (anisongMap[id]) return anisongMap[id];

            // Fallback depuis libraryCacheHandler
            const animeId   = libraryCacheHandler.annSongIdAnnIdMap[id];
            const songEntry = libraryCacheHandler.songEntryMap[id];
            const songMeta  = animeId != null
                ? libraryCacheHandler.animeCache[animeId]?.songMap[id]
                : null;
            const anime     = animeId != null
                ? libraryCacheHandler.animeCache[animeId]
                : null;
            const TYPE_MAP  = { 1: 'OP', 2: 'ED', 3: 'INS' };
            const typeStr   = TYPE_MAP[songMeta?.type] ?? 'UNK';
            const songType  = (songMeta?.number > 0) ? `${typeStr}${songMeta.number}` : typeStr;

            return {
                annSongId:   id,
                songName:    songEntry?.name         ?? null,
                songArtist:  songEntry?.artist?.name ?? null,
                songType,
                animeENName: anime?.mainNames?.EN    ?? null,
                animeJPName: anime?.mainNames?.JA    ?? null,
                HQ:          null,
                MQ:          null,
                audio:       null,
            };
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

    function injectExportButton(list) {
        const $optionContainer = list.$entry.find('.elCustomListEntryOptionContainer');
        if ($optionContainer.find('.elCustomListExportButton').length > 0) return;

        const $btn = $(`
            <div class="elCustomListEntryOption elCustomListExportButton" title="Export to JSON">
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
        customListHandler.customListMap.forEach((list) => {
            injectExportButton(list);
        });
    }

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

    const style = document.createElement('style');
    style.textContent = `
        .elCustomListExportButton { color: #aebbd8; cursor: pointer; }
        .elCustomListExportButton:hover { color: #fff; }
        .elCustomListExportLoading { opacity: 0.6; cursor: wait !important; }
    `;
    document.head.appendChild(style);

})();