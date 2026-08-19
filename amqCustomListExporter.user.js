// ==UserScript==
// @name         AMQ Custom List Exporter
// @namespace    https://github.com/YayaLT/AMQ-Scripts
// @version      1.5
// @description  Adds an export button to each custom list in the AMQ song library. Fetches song metadata from anisongdb (with text search fallback & rate-limit) and exports as JSON.
// @author       YayaLT
// @match        https://*.animemusicquiz.com/*
// @icon         https://animemusicquiz.com/favicon.ico
// @grant        none
// @downloadURL  https://github.com/YayaLT/AMQ-Scripts/raw/main/amqCustomListExporter.user.js
// @updateURL    https://github.com/YayaLT/AMQ-Scripts/raw/main/amqCustomListExporter.user.js
// ==/UserScript==

(function () {
    'use strict';

    const ANISONGDB_BATCH_SIZE = 50;
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // ─── Initialisation ──────────────────────────────────────────────────────────

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
            await sleep(300); // Pause anti-surcharge (503)
        }
        return results;
    }

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
            await sleep(300); // Pause anti-surcharge (503)
        }
        return results;
    }

    // Fallback : recherche textuelle par Nom + Artiste
    async function fetchByTextSearch(songName, songArtist) {
        if (!songName) return null;
        try {
            const payload = {
                song_name_search_filter: { search: songName, partial_match: false },
                and_logic: true,
                ignore_duplicate: false
            };
            if (songArtist) {
                payload.artist_search_filter = { search: songArtist, partial_match: false };
            }

            const response = await fetch('https://anisongdb.com/api/search_request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    // Priorité au résultat qui contient HQ ou MQ
                    return data.find(item => item.HQ || item.MQ) || data[0];
                }
            }
        } catch (e) {
            console.error('[AMQ Exporter] text search error:', e);
        }
        return null;
    }

    // ─── Export ──────────────────────────────────────────────────────────────────

    function getAMQMetadata(annSongId) {
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
            songName:    songEntry?.name        ?? songMeta?.name   ?? null,
            songArtist:  songEntry?.artist?.name ?? songMeta?.artist ?? null,
            songType,
            animeENName: anime?.mainNames?.EN    ?? null,
            animeJPName: anime?.mainNames?.JA    ?? null,
            HQ:          null,
            MQ:          null,
            audio:       null,
        };
    }

    function hasVideoLink(entry) {
        return entry && (entry.HQ || entry.MQ);
    }

    function isValidEntry(entry) {
        return entry && (entry.songName || entry.HQ || entry.MQ || entry.audio);
    }

    async function exportList(list, btn) {
        btn.classList.add('elCustomListExportLoading');
        btn.querySelector('i').className = 'fa fa-spinner fa-spin';

        const annSongIds = [...list.songMap.keys()];

        // Étape 1 : Requête par ANN ID (avec rate-limiting)
        const annMap = await fetchByAnnSongIds(annSongIds);

        // Étape 2 : Requête par AMQ ID pour ce qui n'a pas de vidéo
        const missingVideoIds = annSongIds.filter(id => !hasVideoLink(annMap[id]));
        const amqMap = missingVideoIds.length > 0
            ? await fetchByAmqSongIds(missingVideoIds)
            : {};

        // Étape 3 : Traitement chanson par chanson avec fallback textuel si besoin
        const songs = [];
        for (const annSongId of annSongIds) {
            let entry = annMap[annSongId];

            if (!hasVideoLink(entry) && isValidEntry(amqMap[annSongId])) {
                entry = amqMap[annSongId];
            }

            // Si toujours pas de vidéo, lancer la recherche par Titre/Artiste
            if (!hasVideoLink(entry)) {
                const localMeta = getAMQMetadata(annSongId);
                const searchResult = await fetchByTextSearch(localMeta.songName, localMeta.songArtist);

                if (hasVideoLink(searchResult)) {
                    entry = searchResult;
                } else if (!isValidEntry(entry)) {
                    entry = searchResult || localMeta;
                }
            }

            songs.push(entry);
        }

        // Génération du fichier JSON
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
