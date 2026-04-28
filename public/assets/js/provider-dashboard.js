(function (window, document) {
    const RTP_MIN = 35.1;
    const RTP_MAX = 95.9;
    const RTP_REFRESH_MS = 5 * 60 * 1000;
    const UPDATE_INTERVAL_MS = 5 * 60 * 1000;

    function getCycleKey(intervalMs, now = Date.now()) {
        return Math.floor(now / intervalMs);
    }

    function getNextCycleDelay(intervalMs, now = Date.now()) {
        return Math.max((intervalMs - (now % intervalMs)) + 50, 250);
    }

    function hashString(value) {
        let hash = 2166136261;

        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }

        hash ^= hash >>> 16;
        hash = Math.imul(hash, 2246822507);
        hash ^= hash >>> 13;
        hash = Math.imul(hash, 3266489909);
        hash ^= hash >>> 16;

        return hash >>> 0;
    }

    function getSeedRatio(seed) {
        return hashString(seed) / 4294967295;
    }

    function pickSeeded(list, seed) {
        if (!Array.isArray(list) || list.length === 0) {
            return "";
        }

        const rawIndex = Math.floor(getSeedRatio(seed) * list.length);
        const index = ((rawIndex % list.length) + list.length) % list.length;
        return list[index];
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function isTurboText(value) {
        return /\bTURBO\b/i.test(String(value || ""));
    }

    function isTurboOff(value) {
        return /\bOFF\b/i.test(String(value || ""));
    }

    function getTurboIconMarkup(isOff) {
        return [
            '<span class="pola-turbo-icon' + (isOff ? " off" : "") + '" aria-hidden="true">',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">',
            '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"></path>',
            '</svg>',
            '</span>'
        ].join("");
    }

    function formatPolaValueMarkup(value, extraClassName, baseClassName) {
        const text = String(value || "");
        const className = extraClassName ? " " + extraClassName : "";
        const baseClass = baseClassName || "pola-value";

        if (!isTurboText(text)) {
            return '<div class="' + baseClass + className + '">' + escapeHtml(text) + '</div>';
        }

        const turboOff = isTurboOff(text);
        return [
            '<div class="' + baseClass + ' pola-turbo-value' + className + (turboOff ? " off" : "") + '">',
            getTurboIconMarkup(turboOff),
            '<span>' + escapeHtml(text) + '</span>',
            '</div>'
        ].join("");
    }

    function ensureSharedUiStyles() {
        if (document.getElementById("provider-dashboard-shared-style")) {
            return;
        }

        const style = document.createElement("style");
        style.id = "provider-dashboard-shared-style";
        style.textContent = [
            ".pola-turbo-value{display:inline-flex;align-items:center;justify-content:center;gap:10px;}",
            ".pola-turbo-icon{width:30px;height:30px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:#ffc107;color:#101010;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08);flex:0 0 30px;}",
            ".pola-turbo-icon svg{width:16px;height:16px;}",
            ".pola-turbo-icon.off{background:#141414;color:#8f8f95;}",
            ".pola-value.off .pola-turbo-icon.off,.pola-turbo-value.off .pola-turbo-icon.off{background:#141414;color:#8f8f95;}",
            ".pola-symbols-dc-item{grid-template-columns:minmax(0,1.2fr) minmax(0,0.9fr) minmax(0,0.75fr);align-items:center;}",
            ".pola-symbols-sequence{letter-spacing:0.2em;white-space:nowrap;}"
        ].join("");
        document.head.appendChild(style);
    }

    function normalizeGamesData(gamesData) {
        return (gamesData || []).map((game) => {
            if (typeof game === "string") {
                return { name: game };
            }

            return { name: game.name };
        });
    }

    function clampRtpValue(rtp) {
        return Math.max(35, Math.min(95, Number(rtp)));
    }

    function getRtpBarStyle(rtp) {
        const value = clampRtpValue(rtp);
        const fillPercent = value + "%";

        if (value <= 40) {
            return "--rtp-fill:" + fillPercent + ";--rtp-color-start:#ff5a36;--rtp-color-end:#d81616;";
        }

        if (value <= 60) {
            return "--rtp-fill:" + fillPercent + ";--rtp-color-start:#ff6a1a;--rtp-color-end:#ffb000;";
        }

        if (value <= 70) {
            return "--rtp-fill:" + fillPercent + ";--rtp-color-start:#ffe34d;--rtp-color-end:#ffc61a;";
        }

        if (value <= 89) {
            return "--rtp-fill:" + fillPercent + ";--rtp-color-start:#ffe95c;--rtp-color-end:#27db4f;";
        }

        return "--rtp-fill:" + fillPercent + ";--rtp-color-start:#28f0ff;--rtp-color-end:#163cff;";
    }

    function buildCycleRtpCache(state, cycleKey) {
        const orderedGames = [...state.games].sort((leftGame, rightGame) => {
            const leftSeed = hashString("order:" + state.config.providerKey + ":" + leftGame.name + ":" + cycleKey);
            const rightSeed = hashString("order:" + state.config.providerKey + ":" + rightGame.name + ":" + cycleKey);
            const seedDiff = leftSeed - rightSeed;

            return seedDiff !== 0 ? seedDiff : leftGame.name.localeCompare(rightGame.name);
        });

        const totalGames = Math.max(orderedGames.length - 1, 1);
        return new Map(orderedGames.map((game, index) => {
            const rankRatio = 1 - (index / totalGames);
            const jitterSeed = "rtp:" + state.config.providerKey + ":" + game.name + ":" + cycleKey;
            const jitter = (getSeedRatio(jitterSeed) - 0.5) * 2.4;
            const rtpValue = Math.max(
                RTP_MIN,
                Math.min(RTP_MAX, RTP_MIN + (rankRatio * (RTP_MAX - RTP_MIN)) + jitter)
            );

            return [game.name, rtpValue.toFixed(1)];
        }));
    }

    function getGameRtp(state, gameName, cycleKey = state.currentRtpCycle) {
        const cache = cycleKey === state.currentRtpCycle
            ? state.cycleRtpCache
            : buildCycleRtpCache(state, cycleKey);

        return cache.get(gameName) || RTP_MIN.toFixed(1);
    }

    function normalizeSearchTerm(text) {
        return String(text || "").toLowerCase().trim().replace(/\s+/g, " ");
    }

    function createFallbackImage(gameName) {
        return "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22220%22%3E%3Crect fill=%22%23333%22 width=%22200%22 height=%22220%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-family=%22Arial%22 font-size=%2214%22 fill=%22%23fff%22%3E" + encodeURIComponent(gameName) + "%3C/text%3E%3C/svg%3E";
    }

    function buildGameCardMarkup(state, game) {
        const gameRtp = getGameRtp(state, game.name);
        const fileName = encodeURIComponent(game.name + ".webp");
        const fallbackImage = createFallbackImage(game.name);

        return [
            '<div class="game-card">',
            '<img src="' + state.config.imageFolder + "/" + fileName + '" alt="' + game.name + '" class="game-image" onerror="this.src=\'' + fallbackImage + '\'">',
            '<div class="game-info">',
            '<div class="game-name">' + game.name + '</div>',
            '<div class="rtp-display">',
            '<div class="rtp-text">' + gameRtp + '%</div>',
            '<div class="rtp-bar" style="' + getRtpBarStyle(gameRtp) + '">',
            '<div class="rtp-bar-fill"></div>',
            '<div class="rtp-bar-track"></div>',
            '</div>',
            '</div>',
            '<div class="game-details">',
            state.config.enablePola === false ? "" : '<button class="game-pola" type="button">Pola</button>',
            state.config.enableJamMain === false ? "" : '<button class="game-jam-main" type="button">Jam Main</button>',
            '</div>',
            '</div>',
            '</div>'
        ].join("");
    }

    function renderGames(state, games) {
        if (!state.elements.gamesGrid || !state.elements.noResults) {
            return;
        }

        if (games.length === 0) {
            state.elements.gamesGrid.innerHTML = "";
            state.elements.noResults.style.display = "block";
            return;
        }

        state.elements.noResults.style.display = "none";
        const sortedGames = [...games].sort((leftGame, rightGame) => {
            return parseFloat(getGameRtp(state, rightGame.name)) - parseFloat(getGameRtp(state, leftGame.name));
        });

        state.elements.gamesGrid.innerHTML = sortedGames.map((game) => buildGameCardMarkup(state, game)).join("");
    }

    function searchGames(state, query) {
        const searchTerm = normalizeSearchTerm(query);
        state.filteredGames = state.games.filter((game) => normalizeSearchTerm(game.name).includes(searchTerm));
        renderGames(state, state.filteredGames);
    }

    function createTimeRange(seedPrefix, startHour, endHour) {
        const totalMinutes = Math.max((endHour - startHour) * 60, 60);
        const startOffsetMinutes = Math.floor(getSeedRatio(seedPrefix + ":start") * Math.max(totalMinutes - 30, 1));
        const durationMinutes = 30 + Math.floor(getSeedRatio(seedPrefix + ":duration") * 120);
        const startMinutes = (startHour * 60) + startOffsetMinutes;
        const endMinutes = Math.min((endHour * 60), startMinutes + durationMinutes);

        const formatMinutes = (minutes) => {
            const hour = Math.floor(minutes / 60) % 24;
            const minute = minutes % 60;
            return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
        };

        return formatMinutes(startMinutes) + " - " + formatMinutes(endMinutes);
    }

    function createJamData(state, gameName) {
        const cycleKey = getCycleKey(UPDATE_INTERVAL_MS);
        const seedBase = state.config.providerKey + ":" + gameName + ":" + cycleKey;

        return [
            { title: "Jam Gacor Pagi", time: createTimeRange(seedBase + ":morning", 6, 10) },
            { title: "Jam Gacor Siang", time: createTimeRange(seedBase + ":afternoon", 11, 17) },
            { title: "Jam Gacor Malam", time: createTimeRange(seedBase + ":night", 18, 23) },
            { title: "Jam Gacor Dini Hari", time: createTimeRange(seedBase + ":late", 0, 6) }
        ];
    }

    function createStatusPolaData(state, gameName) {
        const cycleKey = getCycleKey(UPDATE_INTERVAL_MS);
        const seedBase = state.config.providerKey + ":" + gameName + ":" + cycleKey;
        const labelList = state.config.labelList || [];
        const statusList = state.config.statusList || [];

        if (labelList.length > 0 && statusList.length > 0) {
            return Array.from({ length: 3 }, (_, index) => {
                const statusText = pickSeeded(statusList, seedBase + ":status:" + index);

                return {
                    label: pickSeeded(labelList, seedBase + ":label:" + index),
                    statusText: statusText,
                    turboEnabled: statusText.includes(state.config.statusOnKeyword || "ON")
                };
            });
        }

        const modeList = state.config.modeList || ["AUTO", "MANUAL"];
        const modeData = state.config.modeData || {
            AUTO: [10, 20, 30, 50],
            MANUAL: [15, 25]
        };
        const turboOnText = state.config.turboOnText || "ON";
        const turboOffText = state.config.turboOffText || "";
        const patternFormat = state.config.patternFormat || function (mode, amount, turboEnabled) {
            return amount + "x " + mode + (turboEnabled ? " - TURBO" : "");
        };

        return Array.from({ length: 3 }, (_, index) => {
            const mode = pickSeeded(modeList, seedBase + ":mode:" + index);
            const amount = pickSeeded(modeData[mode] || [], seedBase + ":amount:" + index);
            const turboEnabled = getSeedRatio(seedBase + ":turbo:" + index) >= 0.5;

            return {
                label: patternFormat(mode, amount, turboEnabled),
                statusText: turboEnabled ? turboOnText : turboOffText,
                turboEnabled: turboEnabled
            };
        });
    }

    function createColumnsPolaData(state, gameName) {
        const cycleKey = getCycleKey(UPDATE_INTERVAL_MS);
        const seedBase = state.config.providerKey + ":" + gameName + ":" + cycleKey;
        const mainPolaList = state.config.mainPolaList || [];
        const turboPolaList = state.config.turboPolaList || [];
        const quickSpinPolaList = state.config.quickSpinPolaList || [];

        return Array.from({ length: 3 }, (_, index) => ({
            main: pickSeeded(mainPolaList, seedBase + ":main:" + index),
            turbo: pickSeeded(turboPolaList, seedBase + ":turbo:" + index),
            quickSpin: pickSeeded(quickSpinPolaList, seedBase + ":quick:" + index)
        }));
    }

    function createSymbolsDcPolaData(state, gameName) {
        const cycleKey = getCycleKey(UPDATE_INTERVAL_MS);
        const seedBase = state.config.providerKey + ":" + gameName + ":" + cycleKey;
        const modeList = state.config.modeList || ["AUTO", "MANUAL"];
        const modeData = state.config.modeData || {
            AUTO: [10, 20, 30, 50],
            MANUAL: [15, 25, 45]
        };
        const symbolOnText = state.config.symbolOnText || "OK";
        const symbolOffText = state.config.symbolOffText || "NO";
        const dcOptions = state.config.dcOptions || ["DC ON", "DC OFF"];

        return Array.from({ length: 3 }, (_, index) => {
            const mode = pickSeeded(modeList, seedBase + ":mode:" + index);
            const amount = pickSeeded(modeData[mode] || [], seedBase + ":amount:" + index);
            const symbols = Array.from({ length: 3 }, (_, symbolIndex) => {
                return getSeedRatio(seedBase + ":symbol:" + index + ":" + symbolIndex) >= 0.45 ? symbolOnText : symbolOffText;
            }).join(" ");
            const dc = pickSeeded(dcOptions, seedBase + ":dc:" + index);

            return {
                label: mode + " " + amount + "X",
                symbols: symbols,
                dc: dc
            };
        });
    }

    function createDualPolaData(state, gameName) {
        const cycleKey = getCycleKey(UPDATE_INTERVAL_MS);
        const seedBase = state.config.providerKey + ":" + gameName + ":" + cycleKey;
        const patternPool = [
            ...(state.config.autoPatternList || []).map((spin) => "AUTO " + spin + "X"),
            ...(state.config.manualPatternList || []).map((spin) => "MANUAL " + spin + "X"),
            ...(state.config.stopPatternList || []).map((value) => "STOP " + value + "%"),
            ...(state.config.extraPatternLabels || [])
        ];
        const turboOptions = state.config.turboOptions || ["TURBO ON", "TURBO OFF"];

        return Array.from({ length: 3 }, (_, index) => ({
            pattern: pickSeeded(patternPool, seedBase + ":pattern:" + index),
            turbo: pickSeeded(turboOptions, seedBase + ":turbo:" + index)
        }));
    }

    function createPolaData(state, gameName) {
        switch (state.config.polaPreset) {
            case "empty":
                return [];
            case "columns":
                return createColumnsPolaData(state, gameName);
            case "symbols-dc":
                return createSymbolsDcPolaData(state, gameName);
            case "dual":
                return createDualPolaData(state, gameName);
            case "status":
            default:
                return createStatusPolaData(state, gameName);
        }
    }

    function renderStatusPolaData(container, polaItems) {
        container.innerHTML = "";

        polaItems.forEach((item) => {
            const row = document.createElement("div");
            row.className = "pola-item";

            const leftText = document.createElement("span");
            leftText.textContent = item.label;

            const statusGroup = document.createElement("div");
            statusGroup.className = "status-group";

            if (isTurboText(item.statusText)) {
                statusGroup.innerHTML = formatPolaValueMarkup(item.statusText, item.turboEnabled ? "" : "off");
            } else {
                const statusSpan = document.createElement("span");
                statusSpan.className = item.turboEnabled ? "green" : "red";
                statusSpan.textContent = item.statusText;
                statusGroup.appendChild(statusSpan);
            }

            if (!item.turboEnabled && statefulBoolean(container.dataset.withRedBox)) {
                const redBox = document.createElement("div");
                redBox.className = "red-box";
                statusGroup.appendChild(redBox);
            }

            row.appendChild(leftText);
            row.appendChild(statusGroup);
            container.appendChild(row);
        });
    }

    function renderColumnsPolaData(container, polaItems) {
        container.innerHTML = "";

        polaItems.forEach((item) => {
            const row = document.createElement("div");
            row.className = "pola-item";

            [
                item.main,
                item.turbo,
                item.quickSpin
            ].forEach((value) => {
                const column = document.createElement("div");
                column.className = "pola-column";
                column.innerHTML = formatPolaValueMarkup(value, value.includes("OFF") ? " pola-value-off" : "", "pola-column-value");
                row.appendChild(column);
            });

            container.appendChild(row);
        });
    }

    function renderSymbolsDcPolaData(container, polaItems) {
        container.innerHTML = polaItems.map((item) => (
            '<div class="pola-item pola-symbols-dc-item">' +
            '<div class="pola-value">' + escapeHtml(item.label) + '</div>' +
            '<div class="pola-value pola-symbols-sequence">' + escapeHtml(item.symbols) + '</div>' +
            '<div class="pola-value' + (item.dc.includes("OFF") ? ' off' : '') + '">' + escapeHtml(item.dc) + '</div>' +
            '</div>'
        )).join("");
    }

    function renderDualPolaData(container, polaItems) {
        container.innerHTML = polaItems.map((item) => (
            '<div class="pola-item">' +
            formatPolaValueMarkup(item.pattern) +
            formatPolaValueMarkup(item.turbo, item.turbo.includes("OFF") ? "off" : "") +
            '</div>'
        )).join("");
    }

    function renderPolaData(state, polaItems) {
        if (!state.elements.polaContainer) {
            return;
        }

        const container = state.elements.polaContainer;
        container.dataset.withRedBox = state.config.showRedBoxOff ? "true" : "false";

        if (state.config.polaPreset === "empty") {
            container.innerHTML = "";
            return;
        }

        switch (state.config.polaPreset) {
            case "columns":
                renderColumnsPolaData(container, polaItems);
                break;
            case "symbols-dc":
                renderSymbolsDcPolaData(container, polaItems);
                break;
            case "dual":
                renderDualPolaData(container, polaItems);
                break;
            case "status":
            default:
                renderStatusPolaData(container, polaItems);
                break;
        }
    }

    function renderJamData(state, jamItems) {
        if (!state.elements.jamContainer) {
            return;
        }

        state.elements.jamContainer.innerHTML = jamItems.map((item) => (
            '<div class="jam-item">' +
            '<span class="title">' + item.title + '</span>' +
            '<span class="time">' + item.time + '</span>' +
            '</div>'
        )).join("");
    }

    function refreshAllGameRtps(state, force) {
        const nextCycle = getCycleKey(RTP_REFRESH_MS);

        if (!force && nextCycle === state.currentRtpCycle && state.cycleRtpCache.size > 0) {
            return;
        }

        state.currentRtpCycle = nextCycle;
        state.cycleRtpCache = buildCycleRtpCache(state, state.currentRtpCycle);
        renderGames(state, state.filteredGames);
    }

    function scheduleRtpRefresh(state) {
        window.clearTimeout(state.rtpRefreshTimeoutId);

        state.rtpRefreshTimeoutId = window.setTimeout(() => {
            refreshAllGameRtps(state, true);
            scheduleRtpRefresh(state);
        }, getNextCycleDelay(RTP_REFRESH_MS));
    }

    function schedulePolaRefresh(state) {
        window.clearTimeout(state.polaRefreshTimeoutId);

        if (!state.activePolaGameName) {
            return;
        }

        state.polaRefreshTimeoutId = window.setTimeout(() => {
            if (state.elements.polaModal && state.elements.polaModal.classList.contains("active")) {
                renderPolaData(state, createPolaData(state, state.activePolaGameName));
                schedulePolaRefresh(state);
            }
        }, getNextCycleDelay(UPDATE_INTERVAL_MS));
    }

    function scheduleJamRefresh(state) {
        window.clearTimeout(state.jamRefreshTimeoutId);

        if (!state.activeJamGameName) {
            return;
        }

        state.jamRefreshTimeoutId = window.setTimeout(() => {
            if (state.elements.jamModal && state.elements.jamModal.classList.contains("active")) {
                renderJamData(state, createJamData(state, state.activeJamGameName));
                scheduleJamRefresh(state);
            }
        }, getNextCycleDelay(UPDATE_INTERVAL_MS));
    }

    function openPolaModal(state, gameName) {
        if (!state.elements.polaModal) {
            return;
        }

        state.activePolaGameName = gameName;

        if (state.elements.polaGameName) {
            state.elements.polaGameName.textContent = state.config.polaTitleMode === "plain"
                ? gameName
                : "Pola " + gameName;
        }

        renderPolaData(state, createPolaData(state, gameName));
        state.elements.polaModal.classList.add("active");
        schedulePolaRefresh(state);
    }

    function closePolaModal(state) {
        if (!state.elements.polaModal) {
            return;
        }

        state.elements.polaModal.classList.remove("active");
        state.activePolaGameName = null;
        window.clearTimeout(state.polaRefreshTimeoutId);
    }

    function openJamModal(state, gameName) {
        if (!state.elements.jamModal) {
            return;
        }

        state.activeJamGameName = gameName;

        if (state.elements.jamGameName) {
            state.elements.jamGameName.textContent = "Jam Main " + gameName;
        }

        renderJamData(state, createJamData(state, gameName));
        state.elements.jamModal.classList.add("active");
        scheduleJamRefresh(state);
    }

    function closeJamModal(state) {
        if (!state.elements.jamModal) {
            return;
        }

        state.elements.jamModal.classList.remove("active");
        state.activeJamGameName = null;
        window.clearTimeout(state.jamRefreshTimeoutId);
    }

    function statefulBoolean(value) {
        return value === true || value === "true";
    }

    function buildState(config) {
        return {
            config: config,
            games: normalizeGamesData(config.gamesData),
            filteredGames: normalizeGamesData(config.gamesData),
            currentRtpCycle: getCycleKey(RTP_REFRESH_MS),
            cycleRtpCache: new Map(),
            activePolaGameName: null,
            activeJamGameName: null,
            rtpRefreshTimeoutId: null,
            polaRefreshTimeoutId: null,
            jamRefreshTimeoutId: null,
            elements: {
                gamesGrid: document.getElementById(config.gamesGridId || "gamesGrid"),
                noResults: document.getElementById(config.noResultsId || "noResults"),
                searchInput: document.getElementById(config.searchInputId || "searchInput"),
                polaModal: document.getElementById(config.polaModalId || "polaModal"),
                polaContainer: document.getElementById(config.polaContainerId || "polaContainer"),
                polaGameName: document.getElementById(config.polaGameNameId || "polaGameName"),
                polaCloseBtn: document.getElementById(config.polaCloseBtnId || "polaCloseBtn"),
                jamModal: document.getElementById(config.jamModalId || "jamModal"),
                jamContainer: document.getElementById(config.jamContainerId || "jamContainer"),
                jamGameName: document.getElementById(config.jamGameNameId || "jamGameName"),
                jamCloseBtn: document.getElementById(config.jamCloseBtnId || "jamCloseBtn")
            }
        };
    }

    function bindEvents(state) {
        if (state.elements.searchInput) {
            state.elements.searchInput.addEventListener("input", (event) => {
                searchGames(state, event.target.value);
            });
        }

        if (state.elements.polaCloseBtn) {
            state.elements.polaCloseBtn.addEventListener("click", () => closePolaModal(state));
        }

        if (state.elements.jamCloseBtn) {
            state.elements.jamCloseBtn.addEventListener("click", () => closeJamModal(state));
        }

        if (state.elements.polaModal) {
            state.elements.polaModal.addEventListener("click", function (event) {
                if (event.target === this) {
                    closePolaModal(state);
                }
            });
        }

        if (state.elements.jamModal) {
            state.elements.jamModal.addEventListener("click", function (event) {
                if (event.target === this) {
                    closeJamModal(state);
                }
            });
        }

        document.addEventListener("click", (event) => {
            if (event.target.classList.contains("game-pola")) {
                event.stopPropagation();
                const gameCard = event.target.closest(".game-card");
                const gameName = gameCard.querySelector(".game-name").textContent;
                openPolaModal(state, gameName);
            } else if (event.target.classList.contains("game-jam-main")) {
                event.stopPropagation();
                const gameCard = event.target.closest(".game-card");
                const gameName = gameCard.querySelector(".game-name").textContent;
                openJamModal(state, gameName);
            }
        });

        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                refreshAllGameRtps(state, true);
            }
        });

        window.addEventListener("focus", () => {
            refreshAllGameRtps(state, true);
        });
    }

    function init(config) {
        if (!config || !config.providerKey || !Array.isArray(config.gamesData)) {
            return;
        }

        ensureSharedUiStyles();
        const state = buildState(config);
        bindEvents(state);
        refreshAllGameRtps(state, true);
        scheduleRtpRefresh(state);
        window.ProviderDashboardState = state;
    }

    window.ProviderDashboard = {
        init: init
    };

    function autoInit() {
        if (window.providerDashboardConfig) {
            init(window.providerDashboardConfig);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", autoInit, { once: true });
    } else {
        autoInit();
    }
})(window, document);
