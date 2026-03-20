/**
 * Toolasha Core Library
 * Core infrastructure and API clients
 * Version: 1.44.0
 * License: CC-BY-NC-SA-4.0
 */

(function () {
    'use strict';

    window.Toolasha = window.Toolasha || {}; window.Toolasha.__buildTarget = "browser";

    /**
     * Centralized IndexedDB Storage
     * Replaces GM storage with IndexedDB for better performance and Chromium compatibility
     * Provides debounced writes to reduce I/O operations
     */

    class Storage {
        constructor() {
            this.db = null;
            this.available = false;
            this.dbName = 'ToolashaDB';
            this.dbVersion = 13; // Bumped for networthHistory store
            this.saveDebounceTimers = new Map(); // Per-key debounce timers
            this.pendingWrites = new Map(); // Per-key pending write data: {value, storeName}
            this.SAVE_DEBOUNCE_DELAY = 3000; // 3 seconds
        }

        /**
         * Initialize the storage system
         * @returns {Promise<boolean>} Success status
         */
        async initialize() {
            try {
                await this.openDatabase();
                this.available = true;
                return true;
            } catch (error) {
                console.error('[Storage] Initialization failed:', error);
                this.available = false;
                return false;
            }
        }

        /**
         * Open IndexedDB database
         * @returns {Promise<void>}
         */
        openDatabase() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.dbVersion);

                request.onerror = () => {
                    console.error('[Storage] Failed to open IndexedDB', request.error);
                    reject(request.error);
                };

                request.onsuccess = () => {
                    this.db = request.result;
                    // Handle connection being closed unexpectedly (e.g. version upgrade from another tab)
                    this.db.onversionchange = () => {
                        this.db.close();
                        this.db = null;
                        console.warn('[Storage] DB version changed, connection closed. Reload the page.');
                    };
                    resolve();
                };

                request.onblocked = () => {
                    console.warn('[Storage] IndexedDB open blocked by existing connection — retrying after close');
                    // Attempt to close any stale connection and retry once
                    if (this.db) {
                        this.db.close();
                        this.db = null;
                    }
                    const retry = indexedDB.open(this.dbName, this.dbVersion);
                    retry.onerror = () => {
                        console.error('[Storage] Retry failed to open IndexedDB', retry.error);
                        reject(retry.error);
                    };
                    retry.onsuccess = () => {
                        this.db = retry.result;
                        this.db.onversionchange = () => {
                            this.db.close();
                            this.db = null;
                        };
                        resolve();
                    };
                    retry.onupgradeneeded = request.onupgradeneeded;
                    retry.onblocked = () => {
                        console.error('[Storage] IndexedDB still blocked after retry — DB unavailable');
                        reject(new Error('IndexedDB blocked'));
                    };
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // Create settings store if it doesn't exist
                    if (!db.objectStoreNames.contains('settings')) {
                        db.createObjectStore('settings');
                    }

                    // Create rerollSpending store if it doesn't exist (for task reroll tracker)
                    if (!db.objectStoreNames.contains('rerollSpending')) {
                        db.createObjectStore('rerollSpending');
                    }

                    // Create dungeonRuns store if it doesn't exist (for dungeon tracker)
                    if (!db.objectStoreNames.contains('dungeonRuns')) {
                        db.createObjectStore('dungeonRuns');
                    }

                    // Create teamRuns store if it doesn't exist (for team-based backfill)
                    if (!db.objectStoreNames.contains('teamRuns')) {
                        db.createObjectStore('teamRuns');
                    }

                    // Create combatExport store if it doesn't exist (for combat sim/milkonomy exports)
                    if (!db.objectStoreNames.contains('combatExport')) {
                        db.createObjectStore('combatExport');
                    }

                    // Create unifiedRuns store if it doesn't exist (for dungeon tracker unified storage)
                    if (!db.objectStoreNames.contains('unifiedRuns')) {
                        db.createObjectStore('unifiedRuns');
                    }

                    // Create marketListings store if it doesn't exist (for estimated listing ages)
                    if (!db.objectStoreNames.contains('marketListings')) {
                        db.createObjectStore('marketListings');
                    }

                    // Create combatStats store if it doesn't exist (for combat statistics feature)
                    if (!db.objectStoreNames.contains('combatStats')) {
                        db.createObjectStore('combatStats');
                    }

                    // Create xpHistory store if it doesn't exist (for XP/hr tracker)
                    if (!db.objectStoreNames.contains('xpHistory')) {
                        db.createObjectStore('xpHistory');
                    }

                    // Create alchemyHistory store if it doesn't exist (for transmute history tracker)
                    if (!db.objectStoreNames.contains('alchemyHistory')) {
                        db.createObjectStore('alchemyHistory');
                    }

                    // Create labyrinth store if it doesn't exist (for labyrinth tracker)
                    if (!db.objectStoreNames.contains('labyrinth')) {
                        db.createObjectStore('labyrinth');
                    }

                    // Create guildHistory store if it doesn't exist (for guild XP tracker)
                    if (!db.objectStoreNames.contains('guildHistory')) {
                        db.createObjectStore('guildHistory');
                    }

                    // Create networthHistory store if it doesn't exist (for networth chart)
                    if (!db.objectStoreNames.contains('networthHistory')) {
                        db.createObjectStore('networthHistory');
                    }
                };
            });
        }

        /**
         * Get a value from storage
         * @param {string} key - Storage key
         * @param {string} storeName - Object store name (default: 'settings')
         * @param {*} defaultValue - Default value if key doesn't exist
         * @returns {Promise<*>} The stored value or default
         */
        async get(key, storeName = 'settings', defaultValue = null) {
            if (!this.db) {
                console.warn(`[Storage] Database not available, returning default for key: ${key}`);
                return defaultValue;
            }

            return new Promise((resolve, _reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readonly');
                    const store = transaction.objectStore(storeName);
                    const request = store.get(key);

                    request.onsuccess = () => {
                        resolve(request.result !== undefined ? request.result : defaultValue);
                    };

                    request.onerror = () => {
                        console.error(`[Storage] Failed to get key ${key}:`, request.error);
                        resolve(defaultValue);
                    };
                } catch (error) {
                    console.error(`[Storage] Get transaction failed for key ${key}:`, error);
                    resolve(defaultValue);
                }
            });
        }

        /**
         * Set a value in storage (debounced by default)
         * @param {string} key - Storage key
         * @param {*} value - Value to store
         * @param {string} storeName - Object store name (default: 'settings')
         * @param {boolean} immediate - If true, save immediately without debouncing
         * @returns {Promise<boolean>} Success status
         */
        async set(key, value, storeName = 'settings', immediate = false) {
            if (!this.db) {
                console.warn(`[Storage] Database not available, cannot save key: ${key}`);
                return false;
            }

            if (immediate) {
                return this._saveToIndexedDB(key, value, storeName);
            } else {
                return this._debouncedSave(key, value, storeName);
            }
        }

        /**
         * Internal: Save to IndexedDB (immediate)
         * @private
         */
        async _saveToIndexedDB(key, value, storeName) {
            return new Promise((resolve, _reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readwrite');
                    const store = transaction.objectStore(storeName);
                    const request = store.put(value, key);

                    request.onsuccess = () => {
                        resolve(true);
                    };

                    request.onerror = () => {
                        console.error(`[Storage] Failed to save key ${key}:`, request.error);
                        resolve(false);
                    };
                } catch (error) {
                    console.error(`[Storage] Save transaction failed for key ${key}:`, error);
                    resolve(false);
                }
            });
        }

        /**
         * Internal: Debounced save
         * @private
         */
        _debouncedSave(key, value, storeName) {
            const timerKey = `${storeName}:${key}`;

            // Store pending write data
            this.pendingWrites.set(timerKey, { value, storeName });

            // Clear existing timer for this key
            if (this.saveDebounceTimers.has(timerKey)) {
                clearTimeout(this.saveDebounceTimers.get(timerKey));
            }

            // Return a promise that resolves when save completes
            return new Promise((resolve) => {
                const timer = setTimeout(async () => {
                    const pending = this.pendingWrites.get(timerKey);
                    if (pending) {
                        const success = await this._saveToIndexedDB(key, pending.value, pending.storeName);
                        this.pendingWrites.delete(timerKey);
                        this.saveDebounceTimers.delete(timerKey);
                        resolve(success);
                    } else {
                        resolve(false);
                    }
                }, this.SAVE_DEBOUNCE_DELAY);

                this.saveDebounceTimers.set(timerKey, timer);
            });
        }

        /**
         * Get a JSON object from storage
         * @param {string} key - Storage key
         * @param {string} storeName - Object store name (default: 'settings')
         * @param {*} defaultValue - Default value if key doesn't exist
         * @returns {Promise<*>} The parsed object or default
         */
        async getJSON(key, storeName = 'settings', defaultValue = null) {
            const raw = await this.get(key, storeName, null);

            if (raw === null) {
                return defaultValue;
            }

            // If it's already an object, return it
            if (typeof raw === 'object') {
                return raw;
            }

            // Otherwise, try to parse as JSON string
            try {
                return JSON.parse(raw);
            } catch (error) {
                console.error(`[Storage] Error parsing JSON from storage (key: ${key}):`, error);
                return defaultValue;
            }
        }

        /**
         * Set a JSON object in storage
         * @param {string} key - Storage key
         * @param {*} value - Object to store
         * @param {string} storeName - Object store name (default: 'settings')
         * @param {boolean} immediate - If true, save immediately
         * @returns {Promise<boolean>} Success status
         */
        async setJSON(key, value, storeName = 'settings', immediate = false) {
            // IndexedDB can store objects directly, no need to stringify
            return this.set(key, value, storeName, immediate);
        }

        /**
         * Delete a key from storage
         * @param {string} key - Storage key to delete
         * @param {string} storeName - Object store name (default: 'settings')
         * @returns {Promise<boolean>} Success status
         */
        async delete(key, storeName = 'settings') {
            if (!this.db) {
                console.warn(`[Storage] Database not available, cannot delete key: ${key}`);
                return false;
            }

            return new Promise((resolve, _reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readwrite');
                    const store = transaction.objectStore(storeName);
                    const request = store.delete(key);

                    request.onsuccess = () => {
                        resolve(true);
                    };

                    request.onerror = () => {
                        console.error(`[Storage] Failed to delete key ${key}:`, request.error);
                        resolve(false);
                    };
                } catch (error) {
                    console.error(`[Storage] Delete transaction failed for key ${key}:`, error);
                    resolve(false);
                }
            });
        }

        /**
         * Check if a key exists in storage
         * @param {string} key - Storage key to check
         * @param {string} storeName - Object store name (default: 'settings')
         * @returns {Promise<boolean>} True if key exists
         */
        async has(key, storeName = 'settings') {
            if (!this.db) {
                return false;
            }

            const value = await this.get(key, storeName, '__STORAGE_CHECK__');
            return value !== '__STORAGE_CHECK__';
        }

        /**
         * Get all keys from a store
         * @param {string} storeName - Object store name (default: 'settings')
         * @returns {Promise<Array<string>>} Array of keys
         */
        async getAllKeys(storeName = 'settings') {
            if (!this.db) {
                console.warn(`[Storage] Database not available, cannot get keys from store: ${storeName}`);
                return [];
            }

            return new Promise((resolve, _reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readonly');
                    const store = transaction.objectStore(storeName);
                    const request = store.getAllKeys();

                    request.onsuccess = () => {
                        resolve(request.result || []);
                    };

                    request.onerror = () => {
                        console.error(`[Storage] Failed to get all keys from ${storeName}:`, request.error);
                        resolve([]);
                    };
                } catch (error) {
                    console.error(`[Storage] GetAllKeys transaction failed for store ${storeName}:`, error);
                    resolve([]);
                }
            });
        }

        /**
         * Force immediate save of all pending debounced writes
         */
        async flushAll() {
            // Clear all timers first
            for (const timer of this.saveDebounceTimers.values()) {
                if (timer) {
                    clearTimeout(timer);
                }
            }
            this.saveDebounceTimers.clear();

            // Now execute all pending writes immediately
            const writes = Array.from(this.pendingWrites.entries());
            for (const [timerKey, pending] of writes) {
                // Extract actual key from timerKey (format: "storeName:key")
                const colonIndex = timerKey.indexOf(':');
                const storeName = timerKey.substring(0, colonIndex);
                const key = timerKey.substring(colonIndex + 1); // Handle keys with colons

                await this._saveToIndexedDB(key, pending.value, storeName);
            }
            this.pendingWrites.clear();
        }

        /**
         * Cleanup pending debounced writes without flushing
         */
        cleanupPendingWrites() {
            for (const timer of this.saveDebounceTimers.values()) {
                if (timer) {
                    clearTimeout(timer);
                }
            }
            this.saveDebounceTimers.clear();
            this.pendingWrites.clear();
        }
    }

    const storage = new Storage();

    /**
     * Settings Configuration
     * Organizes all script settings into logical groups for the settings UI
     */

    const settingsGroups = {
        general: {
            title: '常规设置',
            icon: '⚙️',
            settings: {
                networkAlert: {
                    id: 'networkAlert',
                    label: '无法获取市场价格数据时显示警报',
                    type: 'checkbox',
                    default: true,
                },
                chatCommands: {
                    id: 'chatCommands',
                    label: '启用聊天命令 (/item, /wiki, /market)',
                    type: 'checkbox',
                    default: true,
                    help: '在聊天框输入 /item、/wiki 或 /market 后接物品名称。例如：/item radiant fiber',
                },
                chat_mentionTracker: {
                    id: 'chat_mentionTracker',
                    label: '在聊天中被提及（@）时显示徽章',
                    type: 'checkbox',
                    default: true,
                    help: '当有人在聊天中 @你时，在聊天标签页上显示红色数字徽章',
                },
                chat_popOut: {
                    id: 'chat_popOut',
                    label: '启用“弹出聊天窗口”按钮',
                    type: 'checkbox',
                    default: true,
                    help: '在聊天面板添加一个按钮，用于在独立浏览器窗口中打开聊天，支持多频道分屏视图',
                },
                altClickNavigation: {
                    id: 'altClickNavigation',
                    label: 'Alt+点击物品跳转至制作/采集或百科',
                    type: 'checkbox',
                    default: true,
                    help: '按住 Alt/Option 键并点击任何物品，可跳转至其制作/采集页面；若不可制作则跳转至物品百科',
                },
                collectionNavigation: {
                    id: 'collectionNavigation',
                    label: '为收藏品添加导航按钮',
                    type: 'checkbox',
                    default: true,
                    help: '点击收藏品时添加“查看动作”和“物品百科”按钮',
                },
            },
        },

        actionPanel: {
            title: '动作面板增强',
            icon: '⚡',
            settings: {
                totalActionTime: {
                    id: 'totalActionTime',
                    label: '左上角：动作条显示模式',
                    type: 'select',
                    default: 'full',
                    options: [{
                            value: 'full',
                            label: '详细 (所有属性 + 时间)'
                        },
                        {
                            value: 'compact',
                            label: '紧凑 (所有属性，限制宽度)'
                        },
                        {
                            value: 'minimal',
                            label: '精简 (仅剩余次数 + 时间)'
                        },
                    ],
                    help: '选择动作条显示的信息。详细模式显示所有统计；紧凑模式限制宽度以适配宽屏；精简模式仅显示剩余动作和完成时间。',
                },
                actionPanel_totalTime: {
                    id: 'actionPanel_totalTime',
                    label: '动作面板：总时间、到达目标等级所需次数、时薪经验',
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_totalTime_quickInputs: {
                    id: 'actionPanel_totalTime_quickInputs',
                    label: '动作面板：快捷输入按钮 (小时、数量预设、最大值)',
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_foragingTotal: {
                    id: 'actionPanel_foragingTotal',
                    label: '动作面板：多产出采集动作的总利润',
                    type: 'checkbox',
                    default: true,
                },
                actionQueue: {
                    id: 'actionQueue',
                    label: '动作队列：显示总时间和预计完成时刻',
                    type: 'checkbox',
                    default: true,
                },
                actionQueue_valueMode: {
                    id: 'actionQueue_valueMode',
                    label: '动作队列：价值计算模式',
                    type: 'select',
                    default: 'profit',
                    options: [{
                            value: 'profit',
                            label: '总利润 (营收 - 所有成本)'
                        },
                        {
                            value: 'estimated_value',
                            label: '预估价值 (税后营收)'
                        },
                    ],
                    help: '选择如何计算队列动作的总价值。利润显示扣除材料和药水后的净收益；预估价值显示扣除市场税后的毛收入（结果始终为正）。',
                },
                actionPanel_outputTotals: {
                    id: 'actionPanel_outputTotals',
                    label: '动作面板：在单次产出下方显示预期总产出',
                    type: 'checkbox',
                    default: true,
                    help: '在动作输入框输入数量时，显示计算出的总产出数量',
                },
                actionPanel_maxProduceable: {
                    id: 'actionPanel_maxProduceable',
                    label: '动作面板：在制作动作上显示最大可制作数量',
                    type: 'checkbox',
                    default: true,
                    help: '根据当前库存显示你可以制作多少个该物品',
                },
                actionPanel_showProfitPerHour: {
                    id: 'actionPanel_showProfitPerHour',
                    label: '动作面板：显示时薪利润 (Profit/hr)',
                    type: 'checkbox',
                    default: true,
                    help: '在采集方块、生产和炼金面板中显示利润/小时统计',
                },
                actionPanel_showExpPerHour: {
                    id: 'actionPanel_showExpPerHour',
                    label: '动作面板：显示时薪经验 (Exp/hr)',
                    type: 'checkbox',
                    default: true,
                    help: '在采集方块和动作面板各部分显示经验/小时统计',
                },
                actionPanel_hideNegativeProfit: {
                    id: 'actionPanel_hideNegativeProfit',
                    label: '动作面板：隐藏利润为负的动作',
                    type: 'checkbox',
                    default: false,
                    help: '隐藏会导致亏损的动作面板',
                },
                requiredMaterials: {
                    id: 'requiredMaterials',
                    label: '动作面板：显示所需总材料和缺少材料',
                    type: 'checkbox',
                    default: true,
                    help: '输入数量时，显示所需的材料总量以及当前缺少的差额',
                },
                alchemy_profitDisplay: {
                    id: 'alchemy_profitDisplay',
                    label: '炼金面板：显示利润计算器',
                    type: 'checkbox',
                    default: true,
                    help: '基于成功率和市场价格，显示炼金动作的利润/小时和利润/天',
                },
                alchemy_transmuteHistory: {
                    id: 'alchemy_transmuteHistory',
                    label: '炼金面板：追踪并查看转化（Transmute）历史',
                    type: 'checkbox',
                    default: true,
                    help: '记录转化阶段并在炼金面板的历史查看器标签页中显示',
                },
                alchemy_coinifyHistory: {
                    id: 'alchemy_coinifyHistory',
                    label: '炼金面板：追踪并查看金币化（Coinify）历史',
                    type: 'checkbox',
                    default: true,
                    help: '记录金币化阶段并在炼金面板的历史查看器标签页中显示',
                },
                actions_missingMaterialsButton: {
                    id: 'actions_missingMaterialsButton',
                    label: '在生产面板显示“购买缺失材料”按钮',
                    type: 'checkbox',
                    default: true,
                    help: '在面板添加按钮，点击可打开市场并自动切换到缺少材料的标签页',
                },
                actions_missingMaterialsButton_ignoreQueue: {
                    id: 'actions_missingMaterialsButton_ignoreQueue',
                    label: '计算缺失材料时忽略已排队的动作',
                    type: 'checkbox',
                    default: false,
                    help: '启用后，缺失材料计算仅考虑当前动作，忽略队列中已预留的材料。默认（关闭）会统计队列需求。',
                },
                lootLogStats: {
                    id: 'lootLogStats',
                    label: '掉落日志统计',
                    type: 'checkbox',
                    default: true,
                    help: '在掉落日志中显示总价值、平均耗时和每日预期产出',
                },
                inventoryCountDisplay: {
                    id: 'inventoryCountDisplay',
                    label: '动作面板：显示产出物品的当前库存数量',
                    type: 'checkbox',
                    default: true,
                    help: '在动作方块和详情面板中显示你当前拥有的产出物品数量',
                },
                actions_pinnedPage: {
                    id: 'actions_pinnedPage',
                    label: '在导航栏添加“已固定动作”页面',
                    type: 'checkbox',
                    default: true,
                    help: '在左侧导航栏添加一个“固定”按钮，集中显示所有已固定的动作及其技能、等级、利润和经验率',
                },
            },
        },

        tooltips: {
            title: '物品提示增强 (Tooltip)',
            icon: '💬',
            settings: {
                itemTooltip_prices: {
                    id: 'itemTooltip_prices',
                    label: '显示 24 小时平均市场价格',
                    type: 'checkbox',
                    default: true,
                },
                itemTooltip_profit: {
                    id: 'itemTooltip_profit',
                    label: '显示生产成本和利润',
                    type: 'checkbox',
                    default: true,
                },
                itemTooltip_detailedProfit: {
                    id: 'itemTooltip_detailedProfit',
                    label: '在利润显示中包含详细材料清单',
                    type: 'checkbox',
                    default: false,
                    help: '显示包含买一价/卖一价、动作/小时和利润细分的材料成本表',
                },
                itemTooltip_multiActionProfit: {
                    id: 'itemTooltip_multiActionProfit',
                    label: '显示该物品所有相关动作的利润对比',
                    type: 'checkbox',
                    default: false,
                    help: '高亮显示利润最高的动作，并在下方列出其他动作（制作、金币化、分解、转化）的摘要',
                },
                itemTooltip_expectedValue: {
                    id: 'itemTooltip_expectedValue',
                    label: '显示可开启容器的预期价值',
                    type: 'checkbox',
                    default: true,
                },
                expectedValue_showDrops: {
                    id: 'expectedValue_showDrops',
                    label: '预期价值掉落列表显示',
                    type: 'select',
                    default: 'All',
                    options: [{
                            value: 'Top 5',
                            label: '价值前 5'
                        },
                        {
                            value: 'Top 10',
                            label: '价值前 10'
                        },
                        {
                            value: 'All',
                            label: '所有掉落'
                        },
                        {
                            value: 'None',
                            label: '仅显示摘要'
                        },
                    ],
                },
                expectedValue_respectPricingMode: {
                    id: 'expectedValue_respectPricingMode',
                    label: '预期价值计算遵循定价模式设置',
                    type: 'checkbox',
                    default: true,
                },
                showConsumTips: {
                    id: 'showConsumTips',
                    label: 'HP/MP 消耗品：恢复速度与性价比',
                    type: 'checkbox',
                    default: true,
                },
                dungeonTokenTooltips: {
                    id: 'dungeonTokenTooltips',
                    label: '副本代币：显示可兑换物品及成本',
                    type: 'checkbox',
                    default: true,
                },
                enhanceSim: {
                    id: 'enhanceSim',
                    label: '显示强化模拟器计算结果',
                    type: 'checkbox',
                    default: true,
                },
                enhanceSim_showConsumedItemsDetail: {
                    id: 'enhanceSim_showConsumedItemsDetail',
                    label: '强化提示：显示消耗物品的详细细分',
                    type: 'checkbox',
                    default: false,
                    help: "启用后，在“贤者之镜”计算中显示每个消耗物品的基础成本/材料/保护项细分",
                },
                itemTooltip_gathering: {
                    id: 'itemTooltip_gathering',
                    label: '显示采集来源和利润',
                    type: 'checkbox',
                    default: true,
                    help: '显示产出此物品的采集动作（采集、伐木、挤奶）',
                },
                itemTooltip_gatheringRareDrops: {
                    id: 'itemTooltip_gatheringRareDrops',
                    label: '显示采集时的稀有掉落',
                    type: 'checkbox',
                    default: true,
                    help: '显示该采集区域可能产出的稀有掉落物（如小行星带的专业之线）',
                },
                itemTooltip_abilityStatus: {
                    id: 'itemTooltip_abilityStatus',
                    label: '显示技能书学习状态',
                    type: 'checkbox',
                    default: true,
                    help: '在技能书提示中显示是否已学习以及当前等级/进度',
                },
                itemTooltip_enhancementMilestones: {
                    id: 'itemTooltip_enhancementMilestones',
                    label: '显示强化里程碑 (+5/+7/+10/+12)',
                    type: 'checkbox',
                    default: false,
                    help: '在未强化的装备提示中显示达到 +5, +7, +10 和 +12 的预期成本和经验',
                },
            },
        },

        enhancementSimulator: {
            title: '强化模拟器设置',
            icon: '✨',
            settings: {
                enhanceSim_autoDetect: {
                    id: 'enhanceSim_autoDetect',
                    label: '自动检测个人属性 (关闭 = 使用市场默认值)',
                    type: 'checkbox',
                    default: false,
                    help: '建议大多数玩家使用市场默认值，以查看专业强化师的现实成本',
                },
                enhanceSim_enhancingLevel: {
                    id: 'enhanceSim_enhancingLevel',
                    label: '强化技能等级',
                    type: 'number',
                    default: 140,
                    min: 1,
                    max: 150,
                    help: '默认：140 (专业强化师等级)',
                },
                enhanceSim_houseLevel: {
                    id: 'enhanceSim_houseLevel',
                    label: '房屋天文台等级',
                    type: 'number',
                    default: 8,
                    min: 0,
                    max: 8,
                    help: '默认：8 (最高等级)',
                },
                enhanceSim_toolBonus: {
                    id: 'enhanceSim_toolBonus',
                    label: '工具成功率加成 %',
                    type: 'number',
                    default: 6.05,
                    min: 0,
                    max: 30,
                    step: 0.01,
                    help: '默认：6.05 (星空强化器 +13)',
                },
                enhanceSim_speedBonus: {
                    id: 'enhanceSim_speedBonus',
                    label: '速度加成 %',
                    type: 'number',
                    default: 48.5,
                    min: 0,
                    max: 100,
                    step: 0.1,
                    help: "默认：48.5 (全套强化装 +10：衣服/裤子/手套 + 贤者项链)",
                },
                enhanceSim_blessedTea: {
                    id: 'enhanceSim_blessedTea',
                    label: '祝福茶 (Blessed Tea) 已激活',
                    type: 'checkbox',
                    default: true,
                    help: '专业强化师使用此茶来减少尝试次数',
                },
                enhanceSim_ultraEnhancingTea: {
                    id: 'enhanceSim_ultraEnhancingTea',
                    label: '究极强化茶 (Ultra) 已激活',
                    type: 'checkbox',
                    default: true,
                    help: '提供 +8 基础技能等级（随饮料浓度缩放）',
                },
                enhanceSim_superEnhancingTea: {
                    id: 'enhanceSim_superEnhancingTea',
                    label: '超级强化茶 (Super) 已激活',
                    type: 'checkbox',
                    default: false,
                    help: '提供 +6 基础技能等级（极效更好）',
                },
                enhanceSim_enhancingTea: {
                    id: 'enhanceSim_enhancingTea',
                    label: '强化茶 已激活',
                    type: 'checkbox',
                    default: false,
                    help: '提供 +3 基础技能等级（极效更好）',
                },
                enhanceSim_drinkConcentration: {
                    id: 'enhanceSim_drinkConcentration',
                    label: '饮料浓度 %',
                    type: 'number',
                    default: 12.9,
                    min: 0,
                    max: 20,
                    step: 0.1,
                    help: '默认：12.9 (暴饮 +10)',
                },
            },
        },

        enhancementTracker: {
            title: '强化追踪器',
            icon: '📊',
            settings: {
                enhancementTracker: {
                    id: 'enhancementTracker',
                    label: '启用强化追踪器',
                    type: 'checkbox',
                    default: false,
                    help: '追踪强化的尝试次数、成本和统计数据',
                },
                enhancementTracker_showOnlyOnEnhancingScreen: {
                    id: 'enhancementTracker_showOnlyOnEnhancingScreen',
                    label: '仅在强化界面显示追踪器',
                    type: 'checkbox',
                    default: false,
                    help: '不在强化界面时隐藏追踪器面板',
                },
            },
        },

        economy: {
            title: '经济与库存',
            icon: '💰',
            settings: {
                networth: {
                    id: 'networth',
                    label: '右上角：显示当前资产 (净资产)',
                    type: 'checkbox',
                    default: true,
                    help: '强化物品按强化模拟器计算的价值估算',
                },
                invWorth: {
                    id: 'invWorth',
                    label: '库存下方：显示库存总览',
                    type: 'checkbox',
                    default: true,
                },
                invSort: {
                    id: 'invSort',
                    label: '按价值对库存物品排序',
                    type: 'checkbox',
                    default: true,
                },
                invSort_showBadges: {
                    id: 'invSort_showBadges',
                    label: '按买一/卖一价排序时显示价值徽章',
                    type: 'checkbox',
                    default: false,
                },
                invSort_badgesOnNone: {
                    id: 'invSort_badgesOnNone',
                    label: '未排序（None）时的徽章类型',
                    type: 'select',
                    default: 'None',
                    options: [{
                            value: 'None',
                            label: '不显示'
                        },
                        {
                            value: 'Ask',
                            label: '卖一价 (Ask)'
                        },
                        {
                            value: 'Bid',
                            label: '买一价 (Bid)'
                        }
                    ],
                },
                invSort_netOfTax: {
                    id: 'invSort_netOfTax',
                    label: '徽章价值扣除市场税',
                    type: 'checkbox',
                    default: false,
                },
                invSort_sortEquipment: {
                    id: 'invSort_sortEquipment',
                    label: '为装备分类启用排序',
                    type: 'checkbox',
                    default: false,
                },
                invBadgePrices: {
                    id: 'invBadgePrices',
                    label: '在物品图标上显示价格徽章',
                    type: 'checkbox',
                    default: false,
                    help: '在库存物品上直接显示单个物品的卖一价和买一价',
                },
                invCategoryTotals: {
                    id: 'invCategoryTotals',
                    label: '在库存中显示各分类总价',
                    type: 'checkbox',
                    default: true,
                    help: '显示每个库存分类下所有物品的总市场价值',
                },
                profitCalc_pricingMode: {
                    id: 'profitCalc_pricingMode',
                    label: '利润计算定价模式',
                    type: 'select',
                    default: 'hybrid',
                    options: [{
                            value: 'conservative',
                            label: '保守 (卖一/买一 - 快速交易)'
                        },
                        {
                            value: 'hybrid',
                            label: '混合 (卖一/卖一 - 即买耐卖)'
                        },
                        {
                            value: 'optimistic',
                            label: '乐观 (买一/卖一 - 耐心交易)'
                        },
                    ],
                },
                actions_artisanMaterialMode: {
                    id: 'actions_artisanMaterialMode',
                    label: '缺失材料：工匠茶（Artisan）需求模式',
                    type: 'select',
                    default: 'expected',
                    options: [{
                            value: 'expected',
                            label: '期望值 (平均消耗)'
                        },
                        {
                            value: 'worst-case',
                            label: '最坏情况 (单次制作向上取整)'
                        },
                    ],
                    help: '在建议购买时，如何计算工匠茶对材料减少的影响。',
                },
                networth_highEnhancementUseCost: {
                    id: 'networth_highEnhancementUseCost',
                    label: '高强化物品使用计算成本而非市场价',
                    type: 'checkbox',
                    default: true,
                    help: '高强化物品（+13及以上）的市场价不可靠。建议使用计算出的强化成本。',
                },
                networth_highEnhancementMinLevel: {
                    id: 'networth_highEnhancementMinLevel',
                    label: '开始使用计算成本的最低强化等级',
                    type: 'select',
                    default: 13,
                    options: [{
                            value: 10,
                            label: '+10 及以上'
                        },
                        {
                            value: 11,
                            label: '+11 及以上'
                        },
                        {
                            value: 12,
                            label: '+12 及以上'
                        },
                        {
                            value: 13,
                            label: '+13 及以上 (推荐)'
                        },
                        {
                            value: 15,
                            label: '+15 及以上'
                        },
                    ],
                    help: '停止信任市场价格并转用计算成本的强化等级阈值',
                },
                networth_includeCowbells: {
                    id: 'networth_includeCowbells',
                    label: '净资产包含牛铃 (Cowbells)',
                    type: 'checkbox',
                    default: false,
                    help: '牛铃不可交易，但会根据 10联装牛铃的市场价计算其价值',
                },
                networth_includeTaskTokens: {
                    id: 'networth_includeTaskTokens',
                    label: '净资产包含任务代币',
                    type: 'checkbox',
                    default: true,
                    help: '根据任务商店宝箱的预期价值估算代币价值。关闭则不计入净资产。',
                },
                networth_abilityBooksAsInventory: {
                    id: 'networth_abilityBooksAsInventory',
                    label: '将技能书计入流动资产 (库存价值)',
                    type: 'checkbox',
                    default: false,
                    help: '将技能书从固定资产移至流动资产。如果你打算卖掉它们，请开启此项。',
                },
                networth_historyChart: {
                    id: 'networth_historyChart',
                    label: '启用净资产历史图表',
                    type: 'checkbox',
                    default: true,
                    help: '记录每小时的净资产快照，并在总净资产旁显示图表图标。关闭将停止记录并隐藏按钮。',
                },
                autoAllButton: {
                    id: 'autoAllButton',
                    label: '开启战利品箱时自动点击“全部”按钮',
                    type: 'checkbox',
                    default: true,
                    help: '打开容器（箱子、板框、缓存）时自动点击全部开启',
                },
                autoAllButton_excludeSeals: {
                    id: 'autoAllButton_excludeSeals',
                    label: '自动点击：跳过“印记 (Seal of...)”类物品',
                    type: 'checkbox',
                    default: true,
                    help: '开启后，迷宫产出的印记类物品不会被自动打开',
                },
            },
        },

        skills: {
            title: '技能',
            icon: '📚',
            settings: {
                xpTracker: {
                    id: 'xpTracker',
                    label: '左侧边栏：在技能条上显示 XP/hr 速率',
                    type: 'checkbox',
                    default: true,
                    help: '在导航面板的每个技能条下方显示实时的时薪经验',
                },
                xpTracker_timeTillLevel: {
                    id: 'xpTracker_timeTillLevel',
                    label: '技能提示：显示升级所需时间',
                    type: 'checkbox',
                    default: true,
                    help: '在技能悬浮提示中，根据当前 XP/hr 估算距离下一级还需多久',
                },
                skillRemainingXP: {
                    id: 'skillRemainingXP',
                    label: '左侧边栏：显示升级所需剩余 XP',
                    type: 'checkbox',
                    default: true,
                    help: '在技能进度条下方显示到达下一级还差多少 XP',
                },
                skillRemainingXP_blackBorder: {
                    id: 'skillRemainingXP_blackBorder',
                    label: '剩余 XP：添加黑色文字边框',
                    type: 'checkbox',
                    default: true,
                    help: '为 XP 文字添加黑色描边/阴影，使其在进度条背景上更清晰',
                },
                skillbook: {
                    id: 'skillbook',
                    label: '技能书：显示到达目标等级所需书量（在百科窗口）',
                    type: 'checkbox',
                    default: true,
                },
            },
        },

        combat: {
            title: '战斗功能',
            icon: '⚔️',
            settings: {
                combatScore: {
                    id: 'combatScore',
                    label: '个人资料面板：显示装备评分 (Gear Score)',
                    type: 'checkbox',
                    default: true,
                },
                abilitiesTriggers: {
                    id: 'abilitiesTriggers',
                    label: '个人资料面板：显示技能与触发器',
                    type: 'checkbox',
                    default: true,
                    help: '在资料下方显示已装备的技能、消耗品及其战斗触发条件',
                },
                characterCard: {
                    id: 'characterCard',
                    label: '个人资料面板：显示“查看卡片”按钮',
                    type: 'checkbox',
                    default: true,
                    help: '添加按钮以在外部查看器中打开角色卡片',
                },
                dungeonTracker: {
                    id: 'dungeonTracker',
                    label: '副本追踪器：实时进度追踪',
                    type: 'checkbox',
                    default: true,
                    help: '通过组队消息追踪副本耗时（经服务器验证）',
                },
                dungeonTrackerUI: {
                    id: 'dungeonTrackerUI',
                    label: '显示副本追踪器 UI 面板',
                    type: 'checkbox',
                    default: true,
                    help: '显示包含波数计数器、历史记录和统计数据的副本进度面板',
                },
                dungeonTrackerChatAnnotations: {
                    id: 'dungeonTrackerChatAnnotations',
                    label: '在组队频道显示运行耗时',
                    type: 'checkbox',
                    default: true,
                    help: '在“钥匙计数”消息中添加带颜色的时间标注（绿色代表快，红色代表慢）',
                },
                labyrinthTracker: {
                    id: 'labyrinthTracker',
                    label: '迷宫最高等级追踪',
                    type: 'checkbox',
                    default: true,
                    help: '追踪每种怪物击败过的最高推荐等级，并显示在自动化标签页中',
                },
                combatSummary: {
                    id: 'combatSummary',
                    label: '战斗摘要：归来时显示详细统计',
                    type: 'checkbox',
                    default: true,
                    help: '从战斗返回时显示场次/小时、收入、经验率等详细数据',
                },
                combatStats: {
                    id: 'combatStats',
                    label: '战斗统计：在战斗面板中显示“统计”标签页',
                    type: 'checkbox',
                    default: true,
                    help: '添加统计按钮，显示收入、利润、消耗品成本、经验和掉落详情',
                },
                combatStats_keyPricing: {
                    id: 'combatStats_keyPricing',
                    label: '战斗统计：定价模式',
                    type: 'select',
                    default: 'ask',
                    options: [{
                            value: 'ask',
                            label: '卖一价 (Ask)'
                        },
                        {
                            value: 'bid',
                            label: '买一价 (Bid)'
                        }
                    ],
                    help: '计算收入、钥匙成本和利润时使用卖一价（即买）还是买一价（耐买）。',
                },
                combatStatsChatMessage: {
                    id: 'combatStatsChatMessage',
                    label: '战斗统计：聊天消息格式',
                    type: 'template',
                    default: [{
                            type: 'text',
                            value: '战斗统计: '
                        },
                        {
                            type: 'variable',
                            key: '{duration}',
                            label: '时长'
                        },
                        {
                            type: 'text',
                            value: ' 耗时 | '
                        },
                        {
                            type: 'variable',
                            key: '{encountersPerHour}',
                            label: '场次/小时'
                        },
                        {
                            type: 'text',
                            value: ' EPH | '
                        },
                        {
                            type: 'variable',
                            key: '{income}',
                            label: '总收入'
                        },
                        {
                            type: 'text',
                            value: ' 收入 | '
                        },
                        {
                            type: 'variable',
                            key: '{dailyIncome}',
                            label: '日收入'
                        },
                        {
                            type: 'text',
                            value: ' 收入/天 | '
                        },
                        {
                            type: 'variable',
                            key: '{dailyConsumableCosts}',
                            label: '日消耗成本'
                        },
                        {
                            type: 'text',
                            value: ' 消耗/天 | '
                        },
                        {
                            type: 'variable',
                            key: '{dailyProfit}',
                            label: '日利润'
                        },
                        {
                            type: 'text',
                            value: ' 利润/天 | '
                        },
                        {
                            type: 'variable',
                            key: '{exp}',
                            label: '经验/小时'
                        },
                        {
                            type: 'text',
                            value: ' 经验/h | '
                        },
                        {
                            type: 'variable',
                            key: '{deathCount}',
                            label: '死亡次数'
                        },
                        {
                            type: 'text',
                            value: ' 死亡'
                        },
                    ],
                    help: 'Ctrl+点击统计面板中的玩家卡片时发送的消息格式。点击“编辑模板”自定义。',
                    templateVariables: [{
                            key: '{duration}',
                            label: '时长',
                            description: '战斗阶段时长'
                        },
                        {
                            key: '{encountersPerHour}',
                            label: '场次/小时',
                            description: '每小时遇敌次数 (EPH)'
                        },
                        {
                            key: '{income}',
                            label: '总收入',
                            description: '战斗获得的总收入'
                        },
                        {
                            key: '{dailyIncome}',
                            label: '日收入',
                            description: '平均每日收入'
                        },
                        {
                            key: '{dailyConsumableCosts}',
                            label: '日消耗成本',
                            description: '平均每日消耗品成本',
                        },
                        {
                            key: '{dailyProfit}',
                            label: '日利润',
                            description: '平均每日利润'
                        },
                        {
                            key: '{exp}',
                            label: '经验/小时',
                            description: '每小时获得的经验'
                        },
                        {
                            key: '{deathCount}',
                            label: '死亡次数',
                            description: '总死亡次数'
                        },
                    ],
                },
            },
        },

        tasks: {
            title: '任务 (Tasks)',
            icon: '📋',
            settings: {
                taskProfitCalculator: {
                    id: 'taskProfitCalculator',
                    label: '显示采集/生产任务的总利润',
                    type: 'checkbox',
                    default: true,
                },
                taskEfficiencyRating: {
                    id: 'taskEfficiencyRating',
                    label: '显示任务效率评分 (代币或利润/小时)',
                    type: 'checkbox',
                    default: true,
                    help: '基于预期完成时间，显示经过颜色分级的效率分数。',
                },
                taskEfficiencyRatingMode: {
                    id: 'taskEfficiencyRatingMode',
                    label: '效率算法',
                    type: 'select',
                    default: 'gold',
                    options: [{
                            value: 'tokens',
                            label: '每小时任务代币'
                        },
                        {
                            value: 'gold',
                            label: '每小时任务利润'
                        },
                    ],
                    help: '选择按代币产出还是按总利润进行评分。',
                },
                taskEfficiencyGradient: {
                    id: 'taskEfficiencyGradient',
                    label: '使用相对渐变色',
                    type: 'checkbox',
                    default: false,
                    help: '根据当前可见的任务相对对比来为效率评分着色。',
                },
                taskRerollTracker: {
                    id: 'taskRerollTracker',
                    label: '追踪任务刷新 (Reroll) 成本',
                    type: 'checkbox',
                    default: true,
                    help: '追踪每次刷新任务花费的金币/牛铃（实验性功能 - 可能会导致 UI 卡顿）',
                },
                taskMapIndex: {
                    id: 'taskMapIndex',
                    label: '在任务上显示战斗区域索引号',
                    type: 'checkbox',
                    default: true,
                },
                taskIcons: {
                    id: 'taskIcons',
                    label: '在任务卡片上显示图标',
                    type: 'checkbox',
                    default: true,
                    help: '在任务卡片背景显示半透明的物品/怪物图标',
                },
                taskIconsDungeons: {
                    id: 'taskIconsDungeons',
                    label: '在战斗任务上显示副本图标',
                    type: 'checkbox',
                    default: false,
                    help: '显示该怪物存在于哪些副本（需要开启任务图标显示）',
                },
                taskSorter_autoSort: {
                    id: 'taskSorter_autoSort',
                    label: '打开任务面板时自动排序',
                    type: 'checkbox',
                    default: false,
                    help: '打开任务面板时，自动按技能类型对任务进行排序',
                },
                taskSorter_hideButton: {
                    id: 'taskSorter_hideButton',
                    label: '隐藏“排序任务”按钮',
                    type: 'checkbox',
                    default: false,
                    help: '隐藏手动排序按钮，但保持自动排序功能生效',
                },
                taskSorter_sortMode: {
                    id: 'taskSorter_sortMode',
                    label: '任务排序模式',
                    type: 'select',
                    default: 'skill',
                    options: [{
                            value: 'skill',
                            label: '技能 / 区域'
                        },
                        {
                            value: 'time',
                            label: '完成所需时间'
                        },
                    ],
                    help: '点击排序时的顺序。“完成时间”会让最快完成的任务排在前面；战斗任务和已完成任务排在最后。',
                },
                taskInventoryHighlighter: {
                    id: 'taskInventoryHighlighter',
                    label: '启用任务库存高亮按钮',
                    type: 'checkbox',
                    default: true,
                    help: '添加一个按钮，用于变暗那些当前非战斗任务不需要的库存物品',
                },
                taskStatistics: {
                    id: 'taskStatistics',
                    label: '在任务面板显示统计按钮',
                    type: 'checkbox',
                    default: true,
                    help: '添加统计按钮，显示溢出时间、预期奖励和完成预估',
                },
                taskGoMerge: {
                    id: 'taskGoMerge',
                    label: '点击“前往 (Go)”时合并重复任务',
                    type: 'checkbox',
                    default: true,
                    help: '点击任务的 Go 时，将所有相同动作的进行中任务所需数量合并为一个单次预填数量',
                },
            },
        },

        ui: {
            title: 'UI 增强',
            icon: '🎨',
            settings: {
                formatting_useKMBFormat: {
                    id: 'formatting_useKMBFormat',
                    label: '使用 K/M/B 数字格式 (例如 1.5M 代替 1,500,000)',
                    type: 'checkbox',
                    default: true,
                    help: '应用于工具提示、动作面板、利润显示及整个 UI 中的所有数字格式',
                },
                ui_externalLinks: {
                    id: 'ui_externalLinks',
                    label: '左侧边栏：显示外部工具链接',
                    type: 'checkbox',
                    default: true,
                    help: '添加指向 Combat Sim、Market Tracker、Enhancelator 和 Milkonomy 的快速链接',
                },
                expPercentage: {
                    id: 'expPercentage',
                    label: '左侧边栏：显示技能经验百分比',
                    type: 'checkbox',
                    default: true,
                },
                itemIconLevel: {
                    id: 'itemIconLevel',
                    label: '图标左下角：显示装备等级',
                    type: 'checkbox',
                    default: true,
                },
                loadoutEnhancementDisplay: {
                    id: 'loadoutEnhancementDisplay',
                    label: '配置（Loadout）面板：在装备图标上显示拥有的最高强化等级',
                    type: 'checkbox',
                    default: true,
                },
                loadout_sortEnabled: {
                    id: 'loadout_sortEnabled',
                    label: '配置面板：启用拖拽重排序',
                    type: 'checkbox',
                    default: true,
                },
                showsKeyInfoInIcon: {
                    id: 'showsKeyInfoInIcon',
                    label: '钥匙图标左下角：显示区域索引',
                    type: 'checkbox',
                    default: true,
                },
                mapIndex: {
                    id: 'mapIndex',
                    label: '战斗区域：显示区域索引号',
                    type: 'checkbox',
                    default: true,
                },
                alchemyItemDimming: {
                    id: 'alchemyItemDimming',
                    label: '炼金面板：变暗等级不足的物品',
                    type: 'checkbox',
                    default: true,
                },
                marketFilter: {
                    id: 'marketFilter',
                    label: '市场：按等级、职业、部位过滤',
                    type: 'checkbox',
                    default: true,
                },
                marketSort: {
                    id: 'marketSort',
                    label: '市场：按盈利率排序物品',
                    type: 'checkbox',
                    default: true,
                    help: '添加按钮以按利润/小时排序市场物品。无利润数据（仅掉落）的物品排在最后。',
                },
                fillMarketOrderPrice: {
                    id: 'fillMarketOrderPrice',
                    label: '自动填充市场订单的最佳价格',
                    type: 'checkbox',
                    default: true,
                },
                market_autoFillSellStrategy: {
                    id: 'market_autoFillSellStrategy',
                    label: '自动填充出售价格策略',
                    type: 'select',
                    default: 'match',
                    options: [{
                            value: 'match',
                            label: '匹配当前最低售价'
                        },
                        {
                            value: 'undercut',
                            label: '压价 1 (最低售价 - 1)'
                        },
                    ],
                    help: '创建出售列表时，选择是匹配还是略低于当前的最低售价',
                },
                market_autoFillBuyStrategy: {
                    id: 'market_autoFillBuyStrategy',
                    label: '自动填充求购价格策略',
                    type: 'select',
                    default: 'outbid',
                    options: [{
                            value: 'outbid',
                            label: '加价 1 (最高求购价 + 1)'
                        },
                        {
                            value: 'match',
                            label: '匹配最高求购价'
                        },
                        {
                            value: 'undercut',
                            label: '压价 1 (最高求购价 - 1)'
                        },
                    ],
                    help: '创建求购订单时，选择是加价竞争、匹配还是略低于当前最高价',
                },
                market_autoClickMax: {
                    id: 'market_autoClickMax',
                    label: '出售对话框自动点击“最大”按钮',
                    type: 'checkbox',
                    default: true,
                    help: '打开出售列表对话框时，自动点击数量字段的 Max 按钮',
                },
                market_quickInputButtons: {
                    id: 'market_quickInputButtons',
                    label: '市场：订单对话框添加快捷输入按钮',
                    type: 'checkbox',
                    default: true,
                    help: '在买/卖对话框添加 10、100、1000 等预设数量按钮',
                },
                market_visibleItemCount: {
                    id: 'market_visibleItemCount',
                    label: '市场：显示物品持有量',
                    type: 'checkbox',
                    default: true,
                    help: '浏览市场时显示你拥有的每种物品数量',
                },
                market_visibleItemCountOpacity: {
                    id: 'market_visibleItemCountOpacity',
                    label: '市场：未持有物品的透明度',
                    type: 'slider',
                    default: 0.25,
                    min: 0,
                    max: 1,
                    step: 0.05,
                    help: '当你拥有的物品数量为零时，该物品方块显示的透明度',
                },
                market_visibleItemCountIncludeEquipped: {
                    id: 'market_visibleItemCountIncludeEquipped',
                    label: '市场：统计包含已装备物品',
                    type: 'checkbox',
                    default: true,
                    help: '在显示的持有数量中包含当前穿戴的装备',
                },
                market_showListingPrices: {
                    id: 'market_showListingPrices',
                    label: '市场：在个人列表中显示价格',
                    type: 'checkbox',
                    default: true,
                    help: '在“我的列表”表格中显示顶层订单价格和总价值',
                },
                market_tradeHistory: {
                    id: 'market_tradeHistory',
                    label: '市场：显示个人交易历史',
                    type: 'checkbox',
                    default: true,
                    help: '在市场中显示你最近一次买入/卖出该物品的价格',
                },
                market_tradeHistoryComparisonMode: {
                    id: 'market_tradeHistoryComparisonMode',
                    label: '市场：交易历史对比模式',
                    type: 'select',
                    default: 'instant',
                    options: [{
                            value: 'instant',
                            label: '即时 (Instant)'
                        },
                        {
                            value: 'listing',
                            label: '挂单 (Orders)'
                        },
                    ],
                    help: '即时模式：对比即时买/卖价。挂单模式：对比买/卖订单价。',
                },
                market_listingPricePrecision: {
                    id: 'market_listingPricePrecision',
                    label: '市场：挂单价格小数点精度',
                    type: 'number',
                    default: 2,
                    min: 0,
                    max: 4,
                    help: '列表价格显示的位数',
                },
                market_showListingAge: {
                    id: 'market_showListingAge',
                    label: '市场：在“我的列表”中显示上架时长',
                    type: 'checkbox',
                    default: false,
                    help: '显示每个列表创建了多久（例如 "3h 45m"）',
                },
                market_showTopOrderAge: {
                    id: 'market_showTopOrderAge',
                    label: '市场：显示竞争对手顶层订单的时长',
                    type: 'checkbox',
                    default: false,
                    help: '显示每个列表中最领先的竞争订单的估计上架时长（需要开启估计时长功能）',
                },
                market_showEstimatedListingAge: {
                    id: 'market_showEstimatedListingAge',
                    label: '市场：在订单簿显示预估时长',
                    type: 'checkbox',
                    default: true,
                    help: '利用列表 ID 插值估算所有市场列表的创建时间',
                },
                market_listingAgeFormat: {
                    id: 'market_listingAgeFormat',
                    label: '市场：时长显示格式',
                    type: 'select',
                    default: 'datetime',
                    options: [{
                            value: 'elapsed',
                            label: '流逝时间 (如 "3h 45m")'
                        },
                        {
                            value: 'datetime',
                            label: '日期/时间 (如 "01-13 14:30")'
                        },
                    ],
                    help: '选择如何显示列表的创建时间',
                },
                market_listingTimeFormat: {
                    id: 'market_listingTimeFormat',
                    label: '市场：日期时间格式中的小时制',
                    type: 'select',
                    default: '24hour',
                    options: [{
                            value: '24hour',
                            label: '24 小时制 (14:30)'
                        },
                        {
                            value: '12hour',
                            label: '12 小时制 (2:30 PM)'
                        },
                    ],
                    help: '使用日期/时间格式时的显示方式',
                },
                market_listingDateFormat: {
                    id: 'market_listingDateFormat',
                    label: '市场：日期格式顺序',
                    type: 'select',
                    default: 'MM-DD',
                    options: [{
                            value: 'MM-DD',
                            label: '月-日 (01-13)'
                        },
                        {
                            value: 'DD-MM',
                            label: '日-月 (13-01)'
                        },
                    ],
                    help: '使用日期/时间格式时的显示方式',
                },
                market_showOrderTotals: {
                    id: 'market_showOrderTotals',
                    label: '市场：在顶部显示总订单金额',
                    type: 'checkbox',
                    default: true,
                    help: '在金币下方显示求购总额 (BO)、出售总额 (SO) 和待领取的金币 (💰)',
                },
                market_showHistoryViewer: {
                    id: 'market_showHistoryViewer',
                    label: '市场：在设置中显示历史查看器按钮',
                    type: 'checkbox',
                    default: true,
                    help: '在设置面板添加“查看市场历史”按钮，用于查看和导出所有市场挂单历史',
                },
                market_showPhiloCalculator: {
                    id: 'market_showPhiloCalculator',
                    label: '市场：在设置中显示 Philo 赌狗计算器按钮',
                    type: 'checkbox',
                    default: true,
                    help: '添加“Philo Gamba”按钮，计算将物品转化成贤者之石的投资回报率 (ROI)',
                },
                market_showQueueLength: {
                    id: 'market_showQueueLength',
                    label: '市场：显示队列长度预估',
                    type: 'checkbox',
                    default: true,
                    help: '在买/卖按钮下方显示最佳价格的总量。预估值（同价格超过 20 个订单时）会以不同颜色显示。',
                },
                itemDictionary_transmuteRates: {
                    id: 'itemDictionary_transmuteRates',
                    label: '物品百科：显示转化成功率',
                    type: 'checkbox',
                    default: true,
                    help: '在“转化自（炼金）”部分显示成功百分比',
                },
                itemDictionary_transmuteIncludeBaseRate: {
                    id: 'itemDictionary_transmuteIncludeBaseRate',
                    label: '物品百科：转化率包含基础成功率',
                    type: 'checkbox',
                    default: true,
                    help: '启用后，显示总概率（基础率 × 掉落率）。关闭后，显示条件概率（仅掉落率，与“转化产出”部分一致）',
                },
            },
        },

        guild: {
            title: '公会',
            icon: '👥',
            settings: {
                guildXPTracker: {
                    id: 'guildXPTracker',
                    label: '追踪公会及成员随时间变化的经验',
                    type: 'checkbox',
                    default: true,
                    help: '通过 WebSocket 消息记录公会和成员 XP 数据，用于计算 XP/hr',
                },
                guildXPDisplay: {
                    id: 'guildXPDisplay',
                    label: '在公会面板和排行榜显示 XP/hr 统计',
                    type: 'checkbox',
                    default: true,
                    help: '在公会概览、成员和公会排行榜标签页显示经验率、排名和每周图表。使用此项时请禁用独立的 Guild XP/h 脚本。',
                },
            },
        },

        house: {
            title: '房屋 (House)',
            icon: '🏠',
            settings: {
                houseUpgradeCosts: {
                    id: 'houseUpgradeCosts',
                    label: '显示升级成本（包含市场价和库存对比）',
                    type: 'checkbox',
                    default: true,
                },
            },
        },

        notifications: {
            title: '通知',
            icon: '🔔',
            settings: {
                notifiEmptyAction: {
                    id: 'notifiEmptyAction',
                    label: '动作队列为空时发送浏览器通知',
                    type: 'checkbox',
                    default: false,
                    help: '仅在游戏页面保持开启状态时有效',
                },
            },
        },

        colors: {
            title: '颜色自定义',
            icon: '🎨',
            settings: {
                color_profit: {
                    id: 'color_profit',
                    label: '利润/正值',
                    type: 'color',
                    default: '#047857',
                    help: '用于利润、收益和正值的颜色',
                },
                color_loss: {
                    id: 'color_loss',
                    label: '亏损/负值',
                    type: 'color',
                    default: '#f87171',
                    help: '用于亏损、成本和负值的颜色',
                },
                color_warning: {
                    id: 'color_warning',
                    label: '警告',
                    type: 'color',
                    default: '#ffa500',
                    help: '用于警告和重要通知的颜色',
                },
                color_info: {
                    id: 'color_info',
                    label: '信息',
                    type: 'color',
                    default: '#60a5fa',
                    help: '用于信息文本和高亮的颜色',
                },
                color_essence: {
                    id: 'color_essence',
                    label: '精华 (Essences)',
                    type: 'color',
                    default: '#c084fc',
                    help: '用于精华掉落和精华相关文本的颜色',
                },
                color_tooltip_profit: {
                    id: 'color_tooltip_profit',
                    label: '提示框利润/正值',
                    type: 'color',
                    default: '#047857',
                    help: '提示框中利润/正值的颜色（适用于浅色背景）',
                },
                color_tooltip_loss: {
                    id: 'color_tooltip_loss',
                    label: '提示框亏损/负值',
                    type: 'color',
                    default: '#dc2626',
                    help: '提示框中亏损/负值的颜色（适用于浅色背景）',
                },
                color_tooltip_info: {
                    id: 'color_tooltip_info',
                    label: '提示框信息',
                    type: 'color',
                    default: '#2563eb',
                    help: '提示框中信息文本的颜色（适用于浅色背景）',
                },
                color_tooltip_warning: {
                    id: 'color_tooltip_warning',
                    label: '提示框警告',
                    type: 'color',
                    default: '#ea580c',
                    help: '提示框中警告文本的颜色（适用于浅色背景）',
                },
                color_text_primary: {
                    id: 'color_text_primary',
                    label: '主要文字',
                    type: 'color',
                    default: '#ffffff',
                    help: '主要文字颜色',
                },
                color_text_secondary: {
                    id: 'color_text_secondary',
                    label: '次要文字',
                    type: 'color',
                    default: '#888888',
                    help: '暗淡/次要文字颜色',
                },
                color_border: {
                    id: 'color_border',
                    label: '边框',
                    type: 'color',
                    default: '#444444',
                    help: '边框和分隔符颜色',
                },
                color_gold: {
                    id: 'color_gold',
                    label: '金币/货币',
                    type: 'color',
                    default: '#ffa500',
                    help: '用于金币和货币显示的颜色',
                },
                color_accent: {
                    id: 'color_accent',
                    label: '脚本强调色',
                    type: 'color',
                    default: '#22c55e',
                    help: '脚本 UI 元素（按钮、标题、区域号、经验百分比等）的主要强调色',
                },
                color_remaining_xp: {
                    id: 'color_remaining_xp',
                    label: '剩余经验文字',
                    type: 'color',
                    default: '#FFFFFF',
                    help: '左侧导航技能栏下方剩余 XP 的颜色',
                },
                color_xp_rate: {
                    id: 'color_xp_rate',
                    label: '经验速率文字',
                    type: 'color',
                    default: '#ffffff',
                },
                color_inv_count: {
                    id: 'color_inv_count',
                    label: '库存计数文字',
                    type: 'color',
                    default: '#ffffff',
                    help: '动作方块和详情面板中显示的库存数量颜色',
                },
                color_invBadge_ask: {
                    id: 'color_invBadge_ask',
                    label: '库存徽章：卖一价',
                    type: 'color',
                    default: '#047857',
                    help: '库存物品卖一价徽章颜色（卖家要价 - 代表更优的销售价值）',
                },
                color_invBadge_bid: {
                    id: 'color_invBadge_bid',
                    label: '库存徽章：买一价',
                    type: 'color',
                    default: '#60a5fa',
                    help: '库存物品买一价徽章颜色（买家出价 - 代表即时卖出的价值）',
                },
                color_transmute: {
                    id: 'color_transmute',
                    label: '转化率',
                    type: 'color',
                    default: '#ffffff',
                    help: '物品百科中转化成功百分比的颜色',
                },
                color_queueLength_known: {
                    id: 'color_queueLength_known',
                    label: '队列长度：已知值',
                    type: 'color',
                    default: '#ffffff',
                    help: '确切队列长度的颜色（当所有可见订单已被统计时）',
                },
                color_queueLength_estimated: {
                    id: 'color_queueLength_estimated',
                    label: '队列长度：预估值',
                    type: 'color',
                    default: '#60a5fa',
                    help: '预估队列长度的颜色（当同价订单超过 20 个进行推算时）',
                },
            },
        },
    };

    /**
     * Settings Storage Module
     * Handles persistence of settings to chrome.storage.local
     */


    class SettingsStorage {
        constructor() {
            this.storageKey = 'script_settingsMap'; // Legacy global key (used as template)
            this.storageArea = 'settings';
            this.currentCharacterId = null; // Current character ID (set after login)
            this.knownCharactersKey = 'known_character_ids'; // List of character IDs
        }

        /**
         * Set the current character ID
         * Must be called after character_initialized event
         * @param {string} characterId - Character ID
         */
        setCharacterId(characterId) {
            this.currentCharacterId = characterId;
        }

        /**
         * Get the storage key for current character
         * Falls back to global key if no character ID set
         * @returns {string} Storage key
         */
        getCharacterStorageKey() {
            if (this.currentCharacterId) {
                return `${this.storageKey}_${this.currentCharacterId}`;
            }
            return this.storageKey; // Fallback to global key
        }

        /**
         * Load all settings from storage
         * Merges saved values with defaults from settings-schema
         * @returns {Promise<Object>} Settings map
         */
        async loadSettings() {
            const characterKey = this.getCharacterStorageKey();
            let saved = await storage.getJSON(characterKey, this.storageArea, null);

            // Migration: If this is a character-specific key and it doesn't exist
            // Copy from global template (old 'script_settingsMap' key)
            if (this.currentCharacterId && !saved) {
                const globalTemplate = await storage.getJSON(this.storageKey, this.storageArea, null);
                if (globalTemplate) {
                    // Copy global template to this character
                    saved = globalTemplate;
                    await storage.setJSON(characterKey, saved, this.storageArea, true);
                }

                // Add character to known characters list
                await this.addToKnownCharacters(this.currentCharacterId);
            }

            const settings = {};

            // Build default settings from config
            for (const group of Object.values(settingsGroups)) {
                for (const [settingId, settingDef] of Object.entries(group.settings)) {
                    settings[settingId] = {
                        id: settingId,
                        desc: settingDef.label,
                        type: settingDef.type || 'checkbox',
                    };

                    // Set default value
                    if (settingDef.type === 'checkbox') {
                        settings[settingId].isTrue = settingDef.default ?? false;
                    } else {
                        settings[settingId].value = settingDef.default ?? '';
                    }

                    // Copy other properties
                    if (settingDef.options) {
                        settings[settingId].options = settingDef.options;
                    }
                    if (settingDef.min !== undefined) {
                        settings[settingId].min = settingDef.min;
                    }
                    if (settingDef.max !== undefined) {
                        settings[settingId].max = settingDef.max;
                    }
                    if (settingDef.step !== undefined) {
                        settings[settingId].step = settingDef.step;
                    }
                }
            }

            // Merge saved settings
            if (saved) {
                for (const [settingId, savedValue] of Object.entries(saved)) {
                    if (settings[settingId]) {
                        // Merge saved boolean values
                        if (savedValue.hasOwnProperty('isTrue')) {
                            settings[settingId].isTrue = savedValue.isTrue;
                        }
                        // Merge saved non-boolean values
                        if (savedValue.hasOwnProperty('value')) {
                            settings[settingId].value = savedValue.value;
                        }
                    }
                }
            }

            return settings;
        }

        /**
         * Save all settings to storage
         * @param {Object} settings - Settings map
         * @returns {Promise<void>}
         */
        async saveSettings(settings) {
            const characterKey = this.getCharacterStorageKey();
            await storage.setJSON(characterKey, settings, this.storageArea, true);
        }

        /**
         * Add character to known characters list
         * @param {string} characterId - Character ID
         * @returns {Promise<void>}
         */
        async addToKnownCharacters(characterId) {
            const knownCharacters = await storage.getJSON(this.knownCharactersKey, this.storageArea, []);
            if (!knownCharacters.includes(characterId)) {
                knownCharacters.push(characterId);
                await storage.setJSON(this.knownCharactersKey, knownCharacters, this.storageArea, true);
            }
        }

        /**
         * Get list of known character IDs
         * @returns {Promise<Array<string>>} Character IDs
         */
        async getKnownCharacters() {
            return await storage.getJSON(this.knownCharactersKey, this.storageArea, []);
        }

        /**
         * Sync current settings to all other characters
         * @param {Object} settings - Current settings to copy
         * @returns {Promise<number>} Number of characters synced
         */
        async syncSettingsToAllCharacters(settings) {
            const knownCharacters = await this.getKnownCharacters();
            let syncedCount = 0;

            for (const characterId of knownCharacters) {
                // Skip current character (already has these settings)
                if (characterId === this.currentCharacterId) {
                    continue;
                }

                // Write settings to this character's key
                const characterKey = `${this.storageKey}_${characterId}`;
                await storage.setJSON(characterKey, settings, this.storageArea, true);
                syncedCount++;
            }

            return syncedCount;
        }

        /**
         * Get a single setting value
         * @param {string} settingId - Setting ID
         * @param {*} defaultValue - Default value if not found
         * @returns {Promise<*>} Setting value
         */
        async getSetting(settingId, defaultValue = null) {
            const settings = await this.loadSettings();
            const setting = settings[settingId];

            if (!setting) {
                return defaultValue;
            }

            // Return boolean for checkbox settings
            if (setting.type === 'checkbox') {
                return setting.isTrue ?? defaultValue;
            }

            // Return value for other settings
            return setting.value ?? defaultValue;
        }

        /**
         * Set a single setting value
         * @param {string} settingId - Setting ID
         * @param {*} value - New value
         * @returns {Promise<void>}
         */
        async setSetting(settingId, value) {
            const settings = await this.loadSettings();

            if (!settings[settingId]) {
                console.warn(`Setting '${settingId}' not found`);
                return;
            }

            // Update value
            if (settings[settingId].type === 'checkbox') {
                settings[settingId].isTrue = value;
            } else {
                settings[settingId].value = value;
            }

            await this.saveSettings(settings);
        }

        /**
         * Reset all settings to defaults
         * @returns {Promise<void>}
         */
        async resetToDefaults() {
            // Simply clear storage - loadSettings() will return defaults
            await storage.remove(this.storageKey, this.storageArea);
        }

        /**
         * Export settings as JSON
         * @returns {Promise<string>} JSON string
         */
        async exportSettings() {
            const settings = await this.loadSettings();
            return JSON.stringify(settings, null, 2);
        }

        /**
         * Import settings from JSON
         * @param {string} jsonString - JSON string
         * @returns {Promise<boolean>} Success
         */
        async importSettings(jsonString) {
            try {
                const imported = JSON.parse(jsonString);
                await this.saveSettings(imported);
                return true;
            } catch (error) {
                console.error('[Settings Storage] Import failed:', error);
                return false;
            }
        }
    }

    const settingsStorage = new SettingsStorage();

    /**
     * Profile Cache Module
     * Stores current profile in memory for Steam users
     */

    // Module-level variable to hold current profile in memory
    let currentProfileCache = null;

    /**
     * Set current profile in memory
     * @param {Object} profileData - Profile data from profile_shared message
     */
    function setCurrentProfile(profileData) {
        currentProfileCache = profileData;
    }

    /**
     * Get current profile from memory
     * @returns {Object|null} Current profile or null
     */
    function getCurrentProfile() {
        return currentProfileCache;
    }

    /**
     * Clear current profile from memory
     */
    function clearCurrentProfile() {
        currentProfileCache = null;
    }

    /**
     * WebSocket Hook Module
     * Intercepts WebSocket messages from the MWI game server
     *
     * Uses WebSocket constructor wrapper for better performance than MessageEvent.prototype.data hooking
     */


    class WebSocketHook {
        constructor() {
            this.isHooked = false;
            this.messageHandlers = new Map();
            this.socketEventHandlers = new Map();
            this.attachedSockets = new WeakSet();
            /**
             * Track processed message events to avoid duplicate handling when multiple hooks fire.
             *
             * We intercept messages through three paths:
             * 1) MessageEvent.prototype.data getter
             * 2) WebSocket.prototype addEventListener/onmessage wrappers
             * 3) Direct socket listeners in attachSocketListeners
             */
            this.processedMessageEvents = new WeakSet();

            /**
             * Track processed messages by content hash to prevent duplicate JSON.parse
             * Uses message content (first 100 chars) as key since same message can have different event objects
             */
            this.processedMessages = new Map(); // message hash -> timestamp
            this.recentActionCompleted = new Map(); // message content -> timestamp (50ms TTL dedup)
            this.messageCleanupInterval = null;
            this.isSocketWrapped = false;
            this.originalWebSocket = null;
            this.currentWebSocket = null;
            // Detect if userscript manager is present (Tampermonkey, Greasemonkey, etc.)
            this.hasScriptManager = typeof GM_info !== 'undefined';
            this.clientDataRetryTimeout = null;
        }

        /**
         * Save combat sim export data to appropriate storage
         * Only saves if script manager is available (cross-domain sharing with Combat Sim)
         * @param {string} key - Storage key
         * @param {string} value - Value to save (JSON string)
         */
        async saveToStorage(key, value) {
            if (this.hasScriptManager) {
                // Tampermonkey: use GM storage for cross-domain sharing with Combat Sim
                // Wrap in setTimeout to make async and prevent main thread blocking
                setTimeout(() => {
                    try {
                        GM_setValue(key, value);
                    } catch (error) {
                        console.error('[WebSocket] Failed to save to GM storage:', error);
                    }
                }, 0);
            }
            // Steam/standalone: Skip saving - Combat Sim import not possible without cross-domain storage
        }

        /**
         * Load combat sim export data from appropriate storage
         * Only loads if script manager is available
         * @param {string} key - Storage key
         * @param {string} defaultValue - Default value if not found
         * @returns {string|null} Stored value or default
         */
        async loadFromStorage(key, defaultValue = null) {
            if (this.hasScriptManager) {
                // Tampermonkey: use GM storage
                return GM_getValue(key, defaultValue);
            }
            // Steam/standalone: No data available (Combat Sim import requires script manager)
            return defaultValue;
        }

        /**
         * Install the WebSocket hook
         * MUST be called before WebSocket connection is established
         * Uses MessageEvent.prototype.data hook (same method as MWI Tools)
         */
        install() {
            if (this.isHooked) {
                console.warn('[WebSocket Hook] Already installed');
                return;
            }

            this.wrapWebSocketConstructor();
            this.wrapWebSocketPrototype();

            // Capture hook instance for closure
            const hookInstance = this;

            // Hook MessageEvent.prototype.data (same as MWI Tools)
            const dataProperty = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data');
            const originalGet = dataProperty.get;

            dataProperty.get = function hookedGet() {
                const socket = this.currentTarget;

                // Only hook WebSocket messages
                if (!(socket instanceof WebSocket)) {
                    return originalGet.call(this);
                }

                // Only hook MWI game server
                if (!hookInstance.isGameSocket(socket)) {
                    return originalGet.call(this);
                }

                hookInstance.attachSocketListeners(socket);

                const message = originalGet.call(this);

                // Anti-loop: define data property so we don't hook our own access
                Object.defineProperty(this, 'data', { value: message });

                // Process message in our hook
                hookInstance.markMessageEventProcessed(this);
                hookInstance.processMessage(message);

                return message;
            };

            Object.defineProperty(MessageEvent.prototype, 'data', dataProperty);

            this.isHooked = true;
        }

        /**
         * Wrap WebSocket prototype handlers to intercept message events
         */
        wrapWebSocketPrototype() {
            const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            if (typeof targetWindow === 'undefined' || !targetWindow.WebSocket || !targetWindow.WebSocket.prototype) {
                return;
            }

            const hookInstance = this;
            const proto = targetWindow.WebSocket.prototype;

            if (!proto.__toolashaPatched) {
                const originalAddEventListener = proto.addEventListener;
                proto.addEventListener = function toolashaAddEventListener(type, listener, options) {
                    if (type === 'message' && typeof listener === 'function') {
                        const wrappedListener = function toolashaMessageListener(event) {
                            if (!hookInstance.isMessageEventProcessed(event) && typeof event?.data === 'string') {
                                hookInstance.markMessageEventProcessed(event);
                                hookInstance.processMessage(event.data);
                            }
                            return listener.call(this, event);
                        };

                        wrappedListener.__toolashaOriginal = listener;
                        return originalAddEventListener.call(this, type, wrappedListener, options);
                    }

                    return originalAddEventListener.call(this, type, listener, options);
                };

                const originalOnMessage = Object.getOwnPropertyDescriptor(proto, 'onmessage');
                if (originalOnMessage && originalOnMessage.set) {
                    Object.defineProperty(proto, 'onmessage', {
                        configurable: true,
                        get: originalOnMessage.get,
                        set(handler) {
                            if (typeof handler !== 'function') {
                                return originalOnMessage.set.call(this, handler);
                            }

                            const wrappedHandler = function toolashaOnMessage(event) {
                                if (!hookInstance.isMessageEventProcessed(event) && typeof event?.data === 'string') {
                                    hookInstance.markMessageEventProcessed(event);
                                    hookInstance.processMessage(event.data);
                                }
                                return handler.call(this, event);
                            };

                            wrappedHandler.__toolashaOriginal = handler;
                            return originalOnMessage.set.call(this, wrappedHandler);
                        },
                    });
                }

                proto.__toolashaPatched = true;
            }
        }

        /**
         * Check if a WebSocket instance belongs to the game server
         * @param {WebSocket} socket - WebSocket instance
         * @returns {boolean} True if game socket
         */
        isGameSocket(socket) {
            if (!socket || !socket.url) {
                return false;
            }

            return (
                socket.url.indexOf('api.milkywayidle.com/ws') !== -1 ||
                socket.url.indexOf('api-test.milkywayidle.com/ws') !== -1
            );
        }

        /**
         * Wrap the WebSocket constructor to attach lifecycle listeners
         */
        wrapWebSocketConstructor() {
            if (this.isSocketWrapped) {
                return;
            }

            const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            if (typeof targetWindow === 'undefined' || !targetWindow.WebSocket) {
                return;
            }

            const hookInstance = this;

            const wrapConstructor = (OriginalWebSocket) => {
                if (!OriginalWebSocket || OriginalWebSocket.__toolashaWrapped) {
                    hookInstance.currentWebSocket = OriginalWebSocket;
                    return;
                }

                class ToolashaWebSocket extends OriginalWebSocket {
                    constructor(...args) {
                        super(...args);
                        hookInstance.attachSocketListeners(this);
                    }
                }

                ToolashaWebSocket.__toolashaWrapped = true;
                ToolashaWebSocket.__toolashaOriginal = OriginalWebSocket;

                hookInstance.originalWebSocket = OriginalWebSocket;
                hookInstance.currentWebSocket = ToolashaWebSocket;
            };

            wrapConstructor(targetWindow.WebSocket);

            Object.defineProperty(targetWindow, 'WebSocket', {
                configurable: true,
                get() {
                    return hookInstance.currentWebSocket;
                },
                set(nextWebSocket) {
                    wrapConstructor(nextWebSocket);
                },
            });
            this.isSocketWrapped = true;
        }

        /**
         * Attach lifecycle listeners to a socket
         * @param {WebSocket} socket - WebSocket instance
         */
        attachSocketListeners(socket) {
            if (!this.isGameSocket(socket)) {
                return;
            }

            if (this.attachedSockets.has(socket)) {
                return;
            }

            this.attachedSockets.add(socket);

            const events = ['open', 'close', 'error'];
            for (const eventName of events) {
                socket.addEventListener(eventName, (event) => {
                    this.emitSocketEvent(eventName, event, socket);
                });
            }

            socket.addEventListener('message', (event) => {
                if (this.isMessageEventProcessed(event)) {
                    return;
                }

                if (!event || typeof event.data !== 'string') {
                    return;
                }

                this.markMessageEventProcessed(event);
                this.processMessage(event.data);
            });
        }

        isMessageEventProcessed(event) {
            if (!event || typeof event !== 'object') {
                return false;
            }

            return this.processedMessageEvents.has(event);
        }

        markMessageEventProcessed(event) {
            if (!event || typeof event !== 'object') {
                return;
            }

            this.processedMessageEvents.add(event);
        }

        /**
         * Process intercepted message
         * @param {string} message - JSON string from WebSocket
         */
        processMessage(message) {
            // Parse message type first to determine deduplication strategy
            let messageType;
            try {
                // Quick parse to get type (avoid full parse for duplicates)
                const typeMatch = message.match(/"type":"([^"]+)"/);
                messageType = typeMatch ? typeMatch[1] : null;
            } catch {
                // If regex fails, skip deduplication and process normally
                messageType = null;
            }

            // Skip deduplication for events where consecutive messages have similar first 100 chars
            // but contain different data (counts, timestamps, etc. beyond the 100-char hash window)
            // OR events that should always trigger UI updates (profile_shared, battle_unit_fetched)
            const skipDedup =
                messageType === 'quests_updated' ||
                messageType === 'action_completed' ||
                messageType === 'items_updated' ||
                messageType === 'market_item_order_books_updated' ||
                messageType === 'market_listings_updated' ||
                messageType === 'profile_shared' ||
                messageType === 'battle_consumable_ability_updated' ||
                messageType === 'battle_unit_fetched' ||
                messageType === 'action_type_consumable_slots_updated' ||
                messageType === 'consumable_buffs_updated' ||
                messageType === 'character_info_updated' ||
                messageType === 'labyrinth_updated';

            if (!skipDedup) {
                // Deduplicate by message content to prevent 4x JSON.parse on same message
                // Use first 100 chars as hash (contains type + timestamp, unique enough)
                const messageHash = message.substring(0, 100);

                if (this.processedMessages.has(messageHash)) {
                    return; // Already processed this message, skip
                }

                this.processedMessages.set(messageHash, Date.now());

                // Cleanup old entries every 100 messages to prevent memory leak
                if (this.processedMessages.size > 100) {
                    this.cleanupProcessedMessages();
                }
            } else if (messageType === 'action_completed') {
                // action_completed bypasses the content-hash dedup (Gabriel's fix, commit 1007215)
                // but the WebSocket prototype wrapper can fire two listeners for the same physical
                // message object. The WeakSet guard catches same-object duplicates, but if two
                // independent listeners each receive a distinct MessageEvent wrapping the same
                // payload, both pass the WeakSet check and processMessage is called twice.
                // Use a short 50ms TTL keyed on full message content to collapse these duplicates.
                // Two genuine consecutive action_completed messages are always seconds apart.
                const now = Date.now();
                if (this.recentActionCompleted.has(message)) {
                    return; // Duplicate from second listener — skip
                }
                this.recentActionCompleted.set(message, now);
                // Prune entries older than 50ms to keep memory bounded
                for (const [key, ts] of this.recentActionCompleted) {
                    if (now - ts > 50) {
                        this.recentActionCompleted.delete(key);
                    }
                }
            }

            try {
                const data = JSON.parse(message);
                const parsedMessageType = data.type;

                // Save critical data to GM storage for Combat Sim export
                this.saveCombatSimData(parsedMessageType, message);

                // Call registered handlers for this message type
                const handlers = this.messageHandlers.get(parsedMessageType) || [];

                for (const handler of handlers) {
                    try {
                        handler(data);
                    } catch (error) {
                        console.error(`[WebSocket] Handler error for ${parsedMessageType}:`, error);
                    }
                }

                // Call wildcard handlers (receive all messages)
                const wildcardHandlers = this.messageHandlers.get('*') || [];
                for (const handler of wildcardHandlers) {
                    try {
                        handler(data);
                    } catch (error) {
                        console.error('[WebSocket] Wildcard handler error:', error);
                    }
                }
            } catch (error) {
                console.error('[WebSocket] Failed to process message:', error);
            }
        }

        /**
         * Save character/battle data for Combat Simulator export
         * @param {string} messageType - Message type
         * @param {string} message - Raw message JSON string
         */
        async saveCombatSimData(messageType, message) {
            try {
                // Save full character data (on login/refresh)
                if (messageType === 'init_character_data') {
                    await this.saveToStorage('toolasha_init_character_data', message);
                }

                // Save client data (for ability special detection)
                if (messageType === 'init_client_data') {
                    await this.saveToStorage('toolasha_init_client_data', message);
                }

                // Save battle data including party members (on combat start)
                if (messageType === 'new_battle') {
                    await this.saveToStorage('toolasha_new_battle', message);
                }

                // Save profile shares (when opening party member profiles)
                if (messageType === 'profile_shared') {
                    const parsed = JSON.parse(message);

                    // Extract character info - try multiple sources for ID
                    parsed.characterID =
                        parsed.profile.sharableCharacter?.id ||
                        parsed.profile.characterSkills?.[0]?.characterID ||
                        parsed.profile.character?.id;
                    parsed.characterName = parsed.profile.sharableCharacter?.name || 'Unknown';
                    parsed.timestamp = Date.now();

                    // Validate we got a character ID
                    if (!parsed.characterID) {
                        console.error('[Toolasha] Failed to extract characterID from profile:', parsed);
                        return;
                    }

                    // Store in memory for Steam users (works without GM storage)
                    setCurrentProfile(parsed);

                    // Load existing profile list from GM storage (cross-origin accessible)
                    const profileListJson = await this.loadFromStorage('toolasha_profile_list', '[]');
                    let profileList = JSON.parse(profileListJson);

                    // Remove old entry for same character
                    profileList = profileList.filter((p) => p.characterID !== parsed.characterID);

                    // Add to front of list
                    profileList.unshift(parsed);

                    // Keep only last 20 profiles
                    if (profileList.length > 20) {
                        profileList.pop();
                    }

                    // Save updated profile list to GM storage (matches pattern of other combat sim data)
                    await this.saveToStorage('toolasha_profile_list', JSON.stringify(profileList));
                }
            } catch (error) {
                console.error('[WebSocket] Failed to save Combat Sim data:', error);
            }
        }

        /**
         * Capture init_client_data from localStorage (fallback method)
         * Called periodically since it may not come through WebSocket
         * Uses official game API to avoid manual decompression
         */
        async captureClientDataFromLocalStorage() {
            try {
                // Use official game API instead of manual localStorage access
                if (typeof localStorageUtil === 'undefined' || typeof localStorageUtil.getInitClientData !== 'function') {
                    // API not ready yet, retry
                    this.scheduleClientDataRetry();
                    return;
                }

                // API returns parsed object and handles decompression automatically
                const clientDataObj = localStorageUtil.getInitClientData();
                if (!clientDataObj || Object.keys(clientDataObj).length === 0) {
                    // Data not available yet, retry
                    this.scheduleClientDataRetry();
                    return;
                }

                // Verify it's init_client_data
                if (clientDataObj?.type === 'init_client_data') {
                    // Save as JSON string for Combat Sim export
                    const clientDataStr = JSON.stringify(clientDataObj);
                    await this.saveToStorage('toolasha_init_client_data', clientDataStr);
                    console.log('[Toolasha] Client data captured from localStorage via official API');
                    this.clearClientDataRetry();
                }
            } catch (error) {
                console.error('[WebSocket] Failed to capture client data from localStorage:', error);
                // Retry on error
                this.scheduleClientDataRetry();
            }
        }

        /**
         * Schedule a retry for client data capture
         */
        scheduleClientDataRetry() {
            this.clearClientDataRetry();
            this.clientDataRetryTimeout = setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
        }

        /**
         * Clear any pending client data retry
         */
        clearClientDataRetry() {
            if (this.clientDataRetryTimeout) {
                clearTimeout(this.clientDataRetryTimeout);
                this.clientDataRetryTimeout = null;
            }
        }

        /**
         * Cleanup old processed message entries (keep last 50, remove rest)
         */
        cleanupProcessedMessages() {
            const entries = Array.from(this.processedMessages.entries());
            // Sort by timestamp, keep newest 50
            entries.sort((a, b) => b[1] - a[1]);

            this.processedMessages.clear();
            for (let i = 0; i < Math.min(50, entries.length); i++) {
                this.processedMessages.set(entries[i][0], entries[i][1]);
            }
        }

        /**
         * Cleanup any pending retry timeouts
         */
        cleanup() {
            this.clearClientDataRetry();
            this.processedMessages.clear();
        }

        /**
         * Register a handler for a specific message type
         * @param {string} messageType - Message type to handle (e.g., "init_character_data")
         * @param {Function} handler - Function to call when message received
         */
        on(messageType, handler) {
            if (!this.messageHandlers.has(messageType)) {
                this.messageHandlers.set(messageType, []);
            }
            const handlers = this.messageHandlers.get(messageType);
            if (!handlers.includes(handler)) {
                handlers.push(handler);
            }
        }

        /**
         * Register a handler for WebSocket lifecycle events
         * @param {string} eventType - Event type (open, close, error)
         * @param {Function} handler - Handler function
         */
        onSocketEvent(eventType, handler) {
            if (!this.socketEventHandlers.has(eventType)) {
                this.socketEventHandlers.set(eventType, []);
            }
            this.socketEventHandlers.get(eventType).push(handler);
        }

        /**
         * Unregister a handler
         * @param {string} messageType - Message type
         * @param {Function} handler - Handler function to remove
         */
        off(messageType, handler) {
            const handlers = this.messageHandlers.get(messageType);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        }

        /**
         * Unregister a WebSocket lifecycle handler
         * @param {string} eventType - Event type
         * @param {Function} handler - Handler function
         */
        offSocketEvent(eventType, handler) {
            const handlers = this.socketEventHandlers.get(eventType);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        }

        emitSocketEvent(eventType, event, socket) {
            const handlers = this.socketEventHandlers.get(eventType) || [];
            for (const handler of handlers) {
                try {
                    handler(event, socket);
                } catch (error) {
                    console.error(`[WebSocket] ${eventType} handler error:`, error);
                }
            }
        }
    }

    const webSocketHook = new WebSocketHook();

    const CONNECTION_STATES = {
        CONNECTED: 'connected',
        DISCONNECTED: 'disconnected',
        RECONNECTING: 'reconnecting',
    };

    class ConnectionState {
        constructor() {
            this.state = CONNECTION_STATES.RECONNECTING;
            this.eventListeners = new Map();
            this.lastDisconnectedAt = null;
            this.lastConnectedAt = null;

            this.setupListeners();
        }

        /**
         * Get current connection state
         * @returns {string} Connection state (connected, disconnected, reconnecting)
         */
        getState() {
            return this.state;
        }

        /**
         * Check if currently connected
         * @returns {boolean} True if connected
         */
        isConnected() {
            return this.state === CONNECTION_STATES.CONNECTED;
        }

        /**
         * Register a listener for connection events
         * @param {string} event - Event name (disconnected, reconnected)
         * @param {Function} callback - Handler function
         */
        on(event, callback) {
            if (!this.eventListeners.has(event)) {
                this.eventListeners.set(event, []);
            }
            this.eventListeners.get(event).push(callback);
        }

        /**
         * Unregister a connection event listener
         * @param {string} event - Event name
         * @param {Function} callback - Handler function to remove
         */
        off(event, callback) {
            const listeners = this.eventListeners.get(event);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        }

        /**
         * Notify connection state from character initialization
         * @param {Object} data - Character initialization payload
         */
        handleCharacterInitialized(data) {
            if (!data) {
                return;
            }

            this.setConnected('character_initialized');
        }

        setupListeners() {
            webSocketHook.onSocketEvent('open', () => {
                this.setReconnecting('socket_open', { allowConnected: true });
            });

            webSocketHook.onSocketEvent('close', (event) => {
                this.setDisconnected('socket_close', event);
            });

            webSocketHook.onSocketEvent('error', (event) => {
                this.setDisconnected('socket_error', event);
            });

            webSocketHook.on('init_character_data', () => {
                this.setConnected('init_character_data');
            });
        }

        setReconnecting(reason, options = {}) {
            if (this.state === CONNECTION_STATES.CONNECTED && !options.allowConnected) {
                return;
            }

            this.updateState(CONNECTION_STATES.RECONNECTING, {
                reason,
            });
        }

        setDisconnected(reason, event) {
            if (this.state === CONNECTION_STATES.DISCONNECTED) {
                return;
            }

            this.lastDisconnectedAt = Date.now();
            this.updateState(CONNECTION_STATES.DISCONNECTED, {
                reason,
                event,
                disconnectedAt: this.lastDisconnectedAt,
            });
        }

        setConnected(reason) {
            if (this.state === CONNECTION_STATES.CONNECTED) {
                return;
            }

            this.lastConnectedAt = Date.now();
            this.updateState(CONNECTION_STATES.CONNECTED, {
                reason,
                disconnectedAt: this.lastDisconnectedAt,
                connectedAt: this.lastConnectedAt,
            });
        }

        updateState(nextState, details) {
            if (this.state === nextState) {
                return;
            }

            const previousState = this.state;
            this.state = nextState;

            if (nextState === CONNECTION_STATES.DISCONNECTED) {
                this.emit('disconnected', {
                    previousState,
                    ...details,
                });
                return;
            }

            if (nextState === CONNECTION_STATES.CONNECTED) {
                this.emit('reconnected', {
                    previousState,
                    ...details,
                });
            }
        }

        emit(event, data) {
            const listeners = this.eventListeners.get(event) || [];
            for (const listener of listeners) {
                try {
                    listener(data);
                } catch (error) {
                    console.error('[ConnectionState] Listener error:', error);
                }
            }
        }
    }

    const connectionState = new ConnectionState();

    /**
     * Merge market listing updates into the current list.
     * @param {Array} currentListings - Existing market listings.
     * @param {Array} updatedListings - Updated listings from WebSocket.
     * @returns {Array} New merged listings array.
     */
    const mergeMarketListings = (currentListings = [], updatedListings = []) => {
        const safeCurrent = Array.isArray(currentListings) ? currentListings : [];
        const safeUpdates = Array.isArray(updatedListings) ? updatedListings : [];

        if (safeUpdates.length === 0) {
            return [...safeCurrent];
        }

        const indexById = new Map();
        safeCurrent.forEach((listing, index) => {
            if (!listing || listing.id === undefined || listing.id === null) {
                return;
            }
            indexById.set(listing.id, index);
        });

        const merged = [...safeCurrent];

        for (const listing of safeUpdates) {
            if (!listing || listing.id === undefined || listing.id === null) {
                continue;
            }

            const existingIndex = indexById.get(listing.id);
            if (existingIndex !== undefined) {
                merged[existingIndex] = listing;
            } else {
                merged.push(listing);
            }
        }

        return merged;
    };

    /**
     * Data Manager Module
     * Central hub for accessing game data
     *
     * Uses official API: localStorageUtil.getInitClientData()
     * Listens to WebSocket messages for player data updates
     */


    class DataManager {
        constructor() {
            this.webSocketHook = webSocketHook;

            // Static game data (items, actions, monsters, abilities, etc.)
            this.initClientData = null;

            // Player data (updated via WebSocket)
            this.characterData = null;
            this.characterSkills = null;
            this.characterItems = null;
            this.characterActions = [];
            this.characterQuests = []; // Active quests including tasks
            this.characterEquipment = new Map();
            this.characterHouseRooms = new Map(); // House room HRID -> {houseRoomHrid, level}
            this.actionTypeDrinkSlotsMap = new Map(); // Action type HRID -> array of drink items
            this.monsterSortIndexMap = new Map(); // Monster HRID -> combat zone sortIndex
            this.bossMonsterHrids = new Set(); // Monster HRIDs that appear in bossSpawns
            this.battleData = null; // Current battle data (for Combat Sim export on Steam)

            // Character tracking for switch detection
            this.currentCharacterId = null;
            this.currentCharacterName = null;
            this.isCharacterSwitching = false;
            this.lastCharacterSwitchTime = 0; // Prevent rapid-fire switch loops

            // Event listeners
            this.eventListeners = new Map();

            // Achievement buff cache (action type → buff type → flat boost)
            this.achievementBuffCache = {
                source: null,
                byActionType: new Map(),
            };

            // Personal buffs from seals (personal_buffs_updated WebSocket message)
            this.personalActionTypeBuffsMap = {};

            // Retry interval for loading static game data
            this.loadRetryInterval = null;
            this.fallbackInterval = null;

            // Setup WebSocket message handlers
            this.setupMessageHandlers();
        }

        /**
         * Initialize the Data Manager
         * Call this after game loads (or immediately - will retry if needed)
         */
        initialize() {
            this.cleanupIntervals();

            // Try to load static game data using official API
            const success = this.tryLoadStaticData();

            // If failed, set up retry polling
            if (!success && !this.loadRetryInterval) {
                this.loadRetryInterval = setInterval(() => {
                    if (this.tryLoadStaticData()) {
                        this.cleanupIntervals();
                    }
                }, 500); // Retry every 500ms
            }

            // FALLBACK: Continuous polling for missed init_character_data (should not be needed with @run-at document-start)
            // Extended timeout for slower connections/computers (Steam, etc.)
            let fallbackAttempts = 0;
            const maxAttempts = 60; // Poll for up to 30 seconds (60 × 500ms)

            const stopFallbackInterval = () => {
                if (this.fallbackInterval) {
                    clearInterval(this.fallbackInterval);
                    this.fallbackInterval = null;
                }
            };

            this.fallbackInterval = setInterval(() => {
                fallbackAttempts++;

                // Stop if character data received via WebSocket
                if (this.characterData) {
                    stopFallbackInterval();
                    return;
                }

                // Give up after max attempts
                if (fallbackAttempts >= maxAttempts) {
                    console.error(
                        '[DataManager] Character data not received after 30 seconds. WebSocket hook may have failed.'
                    );
                    stopFallbackInterval();
                }
            }, 500); // Check every 500ms
        }

        /**
         * Cleanup polling intervals
         */
        cleanupIntervals() {
            if (this.loadRetryInterval) {
                clearInterval(this.loadRetryInterval);
                this.loadRetryInterval = null;
            }

            if (this.fallbackInterval) {
                clearInterval(this.fallbackInterval);
                this.fallbackInterval = null;
            }
        }

        /**
         * Attempt to load static game data
         * @returns {boolean} True if successful, false if needs retry
         * @private
         */
        tryLoadStaticData() {
            try {
                if (typeof localStorageUtil !== 'undefined' && typeof localStorageUtil.getInitClientData === 'function') {
                    const data = localStorageUtil.getInitClientData();
                    if (data && Object.keys(data).length > 0) {
                        this.initClientData = data;

                        // Build monster sort index map for task sorting
                        this.buildMonsterSortIndexMap();

                        return true;
                    }
                }
                return false;
            } catch (error) {
                console.error('[Data Manager] Failed to load init_client_data:', error);
                return false;
            }
        }

        /**
         * Setup WebSocket message handlers
         * Listens for game data updates
         */
        setupMessageHandlers() {
            // Handle init_character_data (player data on login/refresh)
            this.webSocketHook.on('init_character_data', async (data) => {
                // Detect character switch
                const newCharacterId = data.character?.id;
                const newCharacterName = data.character?.name;

                // Validate character data before processing
                if (!newCharacterId || !newCharacterName) {
                    console.error('[DataManager] Invalid character data received:', {
                        hasCharacter: !!data.character,
                        hasId: !!newCharacterId,
                        hasName: !!newCharacterName,
                    });
                    return; // Don't process invalid character data
                }

                // Track whether this is a character switch or first load
                let isCharacterSwitch = false;

                // Check if this is a character switch (not first load)
                if (this.currentCharacterId && this.currentCharacterId !== newCharacterId) {
                    isCharacterSwitch = true;
                    // Prevent rapid-fire character switches (loop protection)
                    const now = Date.now();
                    if (this.lastCharacterSwitchTime && now - this.lastCharacterSwitchTime < 1000) {
                        console.warn('[Toolasha] Ignoring rapid character switch (<1s since last), possible loop detected');
                        return;
                    }
                    this.lastCharacterSwitchTime = now;

                    // Flush all pending storage writes before cleanup (non-blocking)
                    // Use setTimeout to prevent main thread blocking during character switch
                    setTimeout(async () => {
                        try {
                            if (storage && typeof storage.flushAll === 'function') {
                                await storage.flushAll();
                            }
                        } catch (error) {
                            console.error('[Toolasha] Failed to flush storage before character switch:', error);
                        }
                    }, 0);

                    // Set switching flag to block feature initialization
                    this.isCharacterSwitching = true;

                    // Emit character_switching event (cleanup phase)
                    this.emit('character_switching', {
                        oldId: this.currentCharacterId,
                        newId: newCharacterId,
                        oldName: this.currentCharacterName,
                        newName: newCharacterName,
                    });

                    // Update character tracking
                    this.currentCharacterId = newCharacterId;
                    this.currentCharacterName = newCharacterName;

                    // Clear old character data
                    this.characterData = null;
                    this.characterSkills = null;
                    this.characterItems = null;
                    this.characterActions = [];
                    this.characterQuests = [];
                    this.characterEquipment.clear();
                    this.characterHouseRooms.clear();
                    this.actionTypeDrinkSlotsMap.clear();
                    this.personalActionTypeBuffsMap = {};
                    this.battleData = null;

                    // Reset switching flag (cleanup complete, ready for re-init)
                    this.isCharacterSwitching = false;

                    // Emit character_switched event (ready for re-init)
                    this.emit('character_switched', {
                        newId: newCharacterId,
                        newName: newCharacterName,
                    });
                } else if (!this.currentCharacterId) {
                    // First load - set character tracking
                    this.currentCharacterId = newCharacterId;
                    this.currentCharacterName = newCharacterName;
                }

                // Process new character data normally
                this.characterData = data;
                this.characterSkills = data.characterSkills;
                this.characterItems = data.characterItems;
                this.characterActions = [...data.characterActions];
                this.characterQuests = data.characterQuests || [];

                // Build equipment map
                this.updateEquipmentMap(data.characterItems);

                // Build house room map
                this.updateHouseRoomMap(data.characterHouseRoomMap);

                // Build drink slots map (tea buffs)
                this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);

                // Load personal buffs (seal buffs from Labyrinth, may be present on login)
                if (data.personalActionTypeBuffsMap) {
                    this.personalActionTypeBuffsMap = data.personalActionTypeBuffsMap;
                }

                // Clear switching flag
                this.isCharacterSwitching = false;

                // Emit character_initialized event (trigger feature initialization)
                // Include flag to indicate if this is a character switch vs first load
                // IMPORTANT: Mutate data object instead of spreading to avoid copying MB of data
                data._isCharacterSwitch = isCharacterSwitch;
                this.emit('character_initialized', data);
                connectionState.handleCharacterInitialized(data);
            });

            // Handle actions_updated (action queue changes)
            this.webSocketHook.on('actions_updated', (data) => {
                // Update action list
                for (const action of data.endCharacterActions) {
                    if (action.isDone === false) {
                        this.characterActions.push(action);
                    } else {
                        this.characterActions = this.characterActions.filter((a) => a.id !== action.id);
                    }
                }

                this.emit('actions_updated', data);
            });

            // Handle action_completed (action progress)
            this.webSocketHook.on('action_completed', (data) => {
                const action = data.endCharacterAction;
                if (action.isDone === false) {
                    for (let i = 0; i < this.characterActions.length; i++) {
                        if (this.characterActions[i].id === action.id) {
                            // Replace the entire cached action with fresh data from the server
                            // This keeps primaryItemHash, enhancingMaxLevel, etc. up to date
                            this.characterActions[i] = action;
                            break;
                        }
                    }
                }

                // CRITICAL: Update inventory from action_completed (this is how inventory updates during gathering!)
                if (data.endCharacterItems && Array.isArray(data.endCharacterItems)) {
                    for (const endItem of data.endCharacterItems) {
                        // Only update inventory items
                        if (endItem.itemLocationHrid !== '/item_locations/inventory') {
                            continue;
                        }

                        // Find and update the item in inventory
                        const index = this.characterItems.findIndex((invItem) => invItem.id === endItem.id);
                        if (index !== -1) {
                            // Update existing item
                            this.characterItems[index].count = endItem.count;
                        } else {
                            // Add new item to inventory
                            this.characterItems.push(endItem);
                        }
                    }

                    // Notify items_updated listeners (e.g. networth) of the inventory change
                    this.emit('items_updated', data);
                }

                // CRITICAL: Update skill experience from action_completed (this is how XP updates in real-time!)
                if (data.endCharacterSkills && Array.isArray(data.endCharacterSkills) && this.characterSkills) {
                    for (const updatedSkill of data.endCharacterSkills) {
                        const skill = this.characterSkills.find((s) => s.skillHrid === updatedSkill.skillHrid);
                        if (skill) {
                            // Update experience (and level if it changed)
                            skill.experience = updatedSkill.experience;
                            if (updatedSkill.level !== undefined) {
                                skill.level = updatedSkill.level;
                            }
                        }
                    }
                }

                this.emit('action_completed', data);
            });

            // Handle items_updated (inventory/equipment changes)
            this.webSocketHook.on('items_updated', (data) => {
                if (data.endCharacterItems) {
                    // Update inventory items in-place (endCharacterItems contains only changed items, not full inventory)
                    for (const item of data.endCharacterItems) {
                        const index = this.characterItems.findIndex((invItem) => invItem.id === item.id);
                        if (index !== -1) {
                            if (item.count === 0) {
                                // count 0 means removed from this location (e.g. equipped from inventory)
                                this.characterItems.splice(index, 1);
                            } else {
                                // Update existing item (count and location may have changed, e.g. unequip)
                                this.characterItems[index] = { ...this.characterItems[index], ...item };
                            }
                        } else if (item.count > 0) {
                            // New item in inventory or equipment slot
                            this.characterItems.push(item);
                        }
                    }

                    this.updateEquipmentMap(data.endCharacterItems);
                }

                this.emit('items_updated', data);
            });

            // Handle market_listings_updated (market order changes)
            this.webSocketHook.on('market_listings_updated', (data) => {
                if (!this.characterData || !Array.isArray(data?.endMarketListings)) {
                    return;
                }

                const currentListings = Array.isArray(this.characterData.myMarketListings)
                    ? this.characterData.myMarketListings
                    : [];
                const updatedListings = mergeMarketListings(currentListings, data.endMarketListings);

                this.characterData = {
                    ...this.characterData,
                    myMarketListings: updatedListings,
                };

                this.emit('market_listings_updated', {
                    ...data,
                    myMarketListings: updatedListings,
                });
            });

            // Handle market_item_order_books_updated (order book updates)
            this.webSocketHook.on('market_item_order_books_updated', (data) => {
                this.emit('market_item_order_books_updated', data);
            });

            // Handle action_type_consumable_slots_updated (when user changes tea assignments)
            this.webSocketHook.on('action_type_consumable_slots_updated', (data) => {
                // Update drink slots map with new consumables
                if (data.actionTypeDrinkSlotsMap) {
                    this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);
                }

                this.emit('consumables_updated', data);
            });

            // Handle consumable_buffs_updated (when buffs expire/refresh)
            this.webSocketHook.on('consumable_buffs_updated', (data) => {
                // Buffs updated - next hover will show updated values
                this.emit('buffs_updated', data);
            });

            // Handle personal_buffs_updated (seal buffs from Labyrinth)
            this.webSocketHook.on('personal_buffs_updated', (data) => {
                if (data.personalActionTypeBuffsMap) {
                    this.personalActionTypeBuffsMap = data.personalActionTypeBuffsMap;
                }
                this.emit('personal_buffs_updated', data);
            });

            // Handle house_rooms_updated (when user upgrades house rooms)
            this.webSocketHook.on('house_rooms_updated', (data) => {
                // Update house room map with new levels
                if (data.characterHouseRoomMap) {
                    this.updateHouseRoomMap(data.characterHouseRoomMap);
                }

                this.emit('house_rooms_updated', data);
            });

            // Handle skills_updated (when user gains skill levels)
            this.webSocketHook.on('skills_updated', (data) => {
                // Update character skills with new levels
                if (data.characterSkills) {
                    this.characterSkills = data.characterSkills;
                }

                this.emit('skills_updated', data);
            });

            // Handle new_battle (combat start - for Combat Sim export on Steam)
            this.webSocketHook.on('new_battle', (data) => {
                // Store battle data (includes party consumables)
                this.battleData = data;
            });

            // Handle character_info_updated (task slot changes, cooldown timestamps, etc.)
            this.webSocketHook.on('character_info_updated', (data) => {
                if (this.characterData && data.characterInfo) {
                    this.characterData.characterInfo = data.characterInfo;
                }
                this.emit('character_info_updated', data);
            });

            // Handle quests_updated (keep characterQuests in sync mid-session)
            this.webSocketHook.on('quests_updated', (data) => {
                if (data.endCharacterQuests && Array.isArray(data.endCharacterQuests)) {
                    for (const updatedQuest of data.endCharacterQuests) {
                        const index = this.characterQuests.findIndex((q) => q.id === updatedQuest.id);
                        if (index !== -1) {
                            this.characterQuests[index] = updatedQuest;
                        } else {
                            this.characterQuests.push(updatedQuest);
                        }
                    }
                    // Remove claimed quests
                    this.characterQuests = this.characterQuests.filter((q) => q.status !== '/quest_status/claimed');
                }
            });
        }

        /**
         * Update equipment map from character items
         * @param {Array} items - Character items array
         */
        updateEquipmentMap(items) {
            for (const item of items) {
                if (item.itemLocationHrid !== '/item_locations/inventory') {
                    if (item.count === 0) {
                        this.characterEquipment.delete(item.itemLocationHrid);
                    } else {
                        this.characterEquipment.set(item.itemLocationHrid, item);
                    }
                }
            }
        }

        /**
         * Update house room map from character house room data
         * @param {Object} houseRoomMap - Character house room map
         */
        updateHouseRoomMap(houseRoomMap) {
            if (!houseRoomMap) {
                return;
            }

            this.characterHouseRooms.clear();
            for (const [_hrid, room] of Object.entries(houseRoomMap)) {
                this.characterHouseRooms.set(room.houseRoomHrid, room);
            }
        }

        /**
         * Update drink slots map from character data
         * @param {Object} drinkSlotsMap - Action type drink slots map
         */
        updateDrinkSlotsMap(drinkSlotsMap) {
            if (!drinkSlotsMap) {
                return;
            }

            this.actionTypeDrinkSlotsMap.clear();
            for (const [actionTypeHrid, drinks] of Object.entries(drinkSlotsMap)) {
                this.actionTypeDrinkSlotsMap.set(actionTypeHrid, drinks || []);
            }
        }

        /**
         * Get static game data
         * @returns {Object} Init client data (items, actions, monsters, etc.)
         */
        getInitClientData() {
            return this.initClientData;
        }

        /**
         * Get combined game data (static + character)
         * Used for features that need both static data and player data
         * @returns {Object} Combined data object
         */
        getCombinedData() {
            if (!this.initClientData) {
                return null;
            }

            return {
                ...this.initClientData,
                // Character-specific data
                characterItems: this.characterItems || [],
                myMarketListings: this.characterData?.myMarketListings || [],
                characterHouseRoomMap: Object.fromEntries(this.characterHouseRooms),
                characterAbilities: this.characterData?.characterAbilities || [],
                abilityCombatTriggersMap: this.characterData?.abilityCombatTriggersMap || {},
            };
        }

        /**
         * Get item details by HRID
         * @param {string} itemHrid - Item HRID (e.g., "/items/cheese")
         * @returns {Object|null} Item details
         */
        getItemDetails(itemHrid) {
            return this.initClientData?.itemDetailMap?.[itemHrid] || null;
        }

        /**
         * Get action details by HRID
         * @param {string} actionHrid - Action HRID (e.g., "/actions/milking/cow")
         * @returns {Object|null} Action details
         */
        getActionDetails(actionHrid) {
            return this.initClientData?.actionDetailMap?.[actionHrid] || null;
        }

        /**
         * Get player's current actions
         * @returns {Array} Current action queue
         */
        getCurrentActions() {
            return [...this.characterActions];
        }

        /**
         * Get player's equipped items
         * @returns {Map} Equipment map (slot HRID -> item)
         */
        getEquipment() {
            return new Map(this.characterEquipment);
        }

        /**
         * Get MooPass buffs
         * @returns {Array} MooPass buffs array (empty if no MooPass)
         */
        getMooPassBuffs() {
            return this.characterData?.mooPassBuffs || [];
        }

        /**
         * Get player's house rooms
         * @returns {Map} House room map (room HRID -> {houseRoomHrid, level})
         */
        getHouseRooms() {
            return new Map(this.characterHouseRooms);
        }

        /**
         * Get house room level
         * @param {string} houseRoomHrid - House room HRID (e.g., "/house_rooms/brewery")
         * @returns {number} Room level (0 if not found)
         */
        getHouseRoomLevel(houseRoomHrid) {
            const room = this.characterHouseRooms.get(houseRoomHrid);
            return room?.level || 0;
        }

        /**
         * Get active drink items for an action type
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/brewing")
         * @returns {Array} Array of drink items (empty if none)
         */
        getActionDrinkSlots(actionTypeHrid) {
            return this.actionTypeDrinkSlotsMap.get(actionTypeHrid) || [];
        }

        /**
         * Get current character ID
         * @returns {string|null} Character ID or null
         */
        getCurrentCharacterId() {
            return this.currentCharacterId;
        }

        /**
         * Get current character name
         * @returns {string|null} Character name or null
         */
        getCurrentCharacterName() {
            return this.currentCharacterName;
        }

        /**
         * Check if character is currently switching
         * @returns {boolean} True if switching
         */
        getIsCharacterSwitching() {
            return this.isCharacterSwitching;
        }

        /**
         * Get community buff level
         * @param {string} buffTypeHrid - Buff type HRID (e.g., "/community_buff_types/production_efficiency")
         * @returns {number} Buff level (0 if not active)
         */
        getCommunityBuffLevel(buffTypeHrid) {
            if (!this.characterData?.communityBuffs) {
                return 0;
            }

            const buff = this.characterData.communityBuffs.find((b) => b.hrid === buffTypeHrid);
            return buff?.level || 0;
        }

        /**
         * Get achievement buffs for an action type
         * Achievement buffs are provided by the game based on completed achievement tiers
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
         * @returns {Object} Buff object with stat bonuses (e.g., {gatheringQuantity: 0.02}) or empty object
         */
        getAchievementBuffs(actionTypeHrid) {
            if (!this.characterData?.achievementActionTypeBuffsMap) {
                return {};
            }

            return this.characterData.achievementActionTypeBuffsMap[actionTypeHrid] || {};
        }

        /**
         * Get achievement buff flat boost for an action type and buff type
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
         * @param {string} buffTypeHrid - Buff type HRID (e.g., "/buff_types/wisdom")
         * @returns {number} Flat boost value (decimal) or 0 if not found
         */
        getAchievementBuffFlatBoost(actionTypeHrid, buffTypeHrid) {
            const achievementMap = this.characterData?.achievementActionTypeBuffsMap;
            if (!achievementMap) {
                return 0;
            }

            if (this.achievementBuffCache.source !== achievementMap) {
                this.achievementBuffCache = {
                    source: achievementMap,
                    byActionType: new Map(),
                };
            }

            const actionCache = this.achievementBuffCache.byActionType.get(actionTypeHrid) || new Map();
            if (actionCache.has(buffTypeHrid)) {
                return actionCache.get(buffTypeHrid);
            }

            const achievementBuffs = achievementMap[actionTypeHrid];
            if (!Array.isArray(achievementBuffs)) {
                actionCache.set(buffTypeHrid, 0);
                this.achievementBuffCache.byActionType.set(actionTypeHrid, actionCache);
                return 0;
            }

            const buff = achievementBuffs.find((entry) => entry?.typeHrid === buffTypeHrid);
            const flatBoost = buff?.flatBoost || 0;
            actionCache.set(buffTypeHrid, flatBoost);
            this.achievementBuffCache.byActionType.set(actionTypeHrid, actionCache);
            return flatBoost;
        }

        /**
         * Get personal buff flat boost for an action type and buff type (seal buffs from Labyrinth)
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
         * @param {string} buffTypeHrid - Buff type HRID (e.g., "/buff_types/efficiency")
         * @returns {number} Flat boost value (decimal) or 0 if not found
         */
        getPersonalBuffFlatBoost(actionTypeHrid, buffTypeHrid) {
            const personalBuffs = this.personalActionTypeBuffsMap[actionTypeHrid];
            if (!Array.isArray(personalBuffs)) {
                return 0;
            }

            const buff = personalBuffs.find((entry) => entry?.typeHrid === buffTypeHrid);
            return buff?.flatBoost || 0;
        }

        /**
         * Get player's skills
         * @returns {Array|null} Character skills
         */
        getSkills() {
            return this.characterSkills ? [...this.characterSkills] : null;
        }

        /**
         * Get player's inventory
         * @returns {Array|null} Character items
         */
        getInventory() {
            return this.characterItems ? [...this.characterItems] : null;
        }

        /**
         * Get player's market listings
         * @returns {Array} Market listings array
         */
        getMarketListings() {
            return this.characterData?.myMarketListings ? [...this.characterData.myMarketListings] : [];
        }

        /**
         * Get the current blocked character map { [characterId]: name }
         * @returns {Object} Blocked character map, or empty object if not available
         */
        getBlockedCharacterMap() {
            return this.characterData?.blockedCharacterMap || {};
        }

        /**
         * Get active task action HRIDs
         * @returns {Array<string>} Array of action HRIDs that are currently active tasks
         */
        getActiveTaskActionHrids() {
            if (!this.characterQuests || this.characterQuests.length === 0) {
                return [];
            }

            return this.characterQuests
                .filter(
                    (quest) =>
                        quest.category === '/quest_category/random_task' &&
                        quest.status === '/quest_status/in_progress' &&
                        quest.actionHrid
                )
                .map((quest) => quest.actionHrid);
        }

        /**
         * Check if an action is currently an active task
         * @param {string} actionHrid - Action HRID to check
         * @returns {boolean} True if action is an active task
         */
        isTaskAction(actionHrid) {
            const activeTasks = this.getActiveTaskActionHrids();
            return activeTasks.includes(actionHrid);
        }

        /**
         * Get task speed bonus from equipped task badges
         * @returns {number} Task speed percentage (e.g., 15 for 15%)
         */
        getTaskSpeedBonus() {
            if (!this.characterEquipment || !this.initClientData) {
                return 0;
            }

            let totalTaskSpeed = 0;

            // Task badges are in trinket slot
            const trinketLocation = '/item_locations/trinket';
            const equippedItem = this.characterEquipment.get(trinketLocation);

            if (!equippedItem || !equippedItem.itemHrid) {
                return 0;
            }

            const itemDetail = this.initClientData.itemDetailMap[equippedItem.itemHrid];
            if (!itemDetail || !itemDetail.equipmentDetail) {
                return 0;
            }

            const taskSpeed = itemDetail.equipmentDetail.noncombatStats?.taskSpeed || 0;
            if (taskSpeed === 0) {
                return 0;
            }

            // Calculate enhancement bonus
            // Note: noncombatEnhancementBonuses already includes slot multiplier (5× for trinket)
            const enhancementLevel = equippedItem.enhancementLevel || 0;
            const enhancementBonus = itemDetail.equipmentDetail.noncombatEnhancementBonuses?.taskSpeed || 0;
            const totalEnhancementBonus = enhancementBonus * enhancementLevel;

            // Total taskSpeed = base + enhancement
            totalTaskSpeed = (taskSpeed + totalEnhancementBonus) * 100; // Convert to percentage

            return totalTaskSpeed;
        }

        /**
         * Build monster-to-sortIndex mapping from combat zone data
         * Used for sorting combat tasks by zone progression order
         * @private
         */
        buildMonsterSortIndexMap() {
            if (!this.initClientData || !this.initClientData.actionDetailMap) {
                return;
            }

            this.monsterSortIndexMap.clear();
            this.bossMonsterHrids.clear();

            // Extract combat zones (non-dungeon only)
            for (const [_zoneHrid, action] of Object.entries(this.initClientData.actionDetailMap)) {
                // Skip non-combat actions and dungeons
                if (action.type !== '/action_types/combat' || action.combatZoneInfo?.isDungeon) {
                    continue;
                }

                const sortIndex = action.sortIndex;

                // Get regular spawn monsters
                const regularMonsters = action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.spawns || [];

                // Get boss monsters (every 10 battles)
                const bossMonsters = action.combatZoneInfo?.fightInfo?.bossSpawns || [];

                // Track boss monster HRIDs
                for (const boss of bossMonsters) {
                    if (boss.combatMonsterHrid) {
                        this.bossMonsterHrids.add(boss.combatMonsterHrid);
                    }
                }

                // Combine all monsters from this zone
                const allMonsters = [...regularMonsters, ...bossMonsters];

                // Map each monster to this zone's sortIndex
                for (const spawn of allMonsters) {
                    const monsterHrid = spawn.combatMonsterHrid;
                    if (!monsterHrid) continue;

                    // If monster appears in multiple zones, use earliest zone (lowest sortIndex)
                    if (
                        !this.monsterSortIndexMap.has(monsterHrid) ||
                        sortIndex < this.monsterSortIndexMap.get(monsterHrid)
                    ) {
                        this.monsterSortIndexMap.set(monsterHrid, sortIndex);
                    }
                }
            }
        }

        /**
         * Get zone sortIndex for a monster (for task sorting)
         * @param {string} monsterHrid - Monster HRID (e.g., "/monsters/rat")
         * @returns {number} Zone sortIndex (999 if not found)
         */
        getMonsterSortIndex(monsterHrid) {
            return this.monsterSortIndexMap.get(monsterHrid) || 999;
        }

        /**
         * Check if a monster is a boss (appears in bossSpawns of any combat zone)
         * @param {string} monsterHrid - Monster HRID (e.g., "/monsters/crystal_colossus")
         * @returns {boolean} True if the monster is a boss
         */
        isBossMonster(monsterHrid) {
            return this.bossMonsterHrids.has(monsterHrid);
        }

        /**
         * Get monster HRID from display name (for task sorting)
         * @param {string} monsterName - Monster display name (e.g., "Jerry")
         * @returns {string|null} Monster HRID or null if not found
         */
        getMonsterHridFromName(monsterName) {
            if (!this.initClientData || !this.initClientData.combatMonsterDetailMap) {
                return null;
            }

            // Search for monster by display name
            for (const [hrid, monster] of Object.entries(this.initClientData.combatMonsterDetailMap)) {
                if (monster.name === monsterName) {
                    return hrid;
                }
            }

            return null;
        }

        /**
         * Register event listener
         * @param {string} event - Event name
         * @param {Function} callback - Handler function
         */
        on(event, callback) {
            if (!this.eventListeners.has(event)) {
                this.eventListeners.set(event, []);
            }
            this.eventListeners.get(event).push(callback);
        }

        /**
         * Unregister event listener
         * @param {string} event - Event name
         * @param {Function} callback - Handler function to remove
         */
        off(event, callback) {
            const listeners = this.eventListeners.get(event);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        }

        /**
         * Emit event to all listeners
         * Only character_switching is critical (must run immediately for proper cleanup)
         * All other events including character_switched and character_initialized are deferred
         * @param {string} event - Event name
         * @param {*} data - Event data
         */
        emit(event, data) {
            const listeners = this.eventListeners.get(event) || [];

            // Only character_switching must run immediately (cleanup phase)
            // character_switched can be deferred - it just schedules re-init anyway
            const isCritical = event === 'character_switching';

            if (isCritical) {
                // Run immediately on main thread
                for (const listener of listeners) {
                    try {
                        listener(data);
                    } catch (error) {
                        console.error(`[Data Manager] Error in ${event} listener:`, error);
                    }
                }
            } else {
                // Defer all other events to prevent main thread blocking
                setTimeout(() => {
                    for (const listener of listeners) {
                        try {
                            listener(data);
                        } catch (error) {
                            console.error(`[Data Manager] Error in ${event} listener:`, error);
                        }
                    }
                }, 0);
            }
        }
    }

    const dataManager = new DataManager();

    /**
     * Configuration Module
     * Manages all script constants and user settings
     */


    /**
     * Config class manages all script configuration
     * - Constants (colors, URLs, formatters)
     * - User settings with persistence
     */
    class Config {
        constructor() {
            // Number formatting separators (locale-aware)
            this.THOUSAND_SEPARATOR = new Intl.NumberFormat().format(1111).replaceAll('1', '').at(0) || '';
            this.DECIMAL_SEPARATOR = new Intl.NumberFormat().format(1.1).replaceAll('1', '').at(0);

            // Extended color palette (configurable)
            // Dark background colors (for UI elements on dark backgrounds)
            this.COLOR_PROFIT = '#047857'; // Emerald green for positive values
            this.COLOR_LOSS = '#f87171'; // Red for negative values
            this.COLOR_WARNING = '#ffa500'; // Orange for warnings
            this.COLOR_INFO = '#60a5fa'; // Blue for informational
            this.COLOR_ESSENCE = '#c084fc'; // Purple for essences

            // Tooltip colors (for text on light/tooltip backgrounds)
            this.COLOR_TOOLTIP_PROFIT = '#047857'; // Green for tooltips
            this.COLOR_TOOLTIP_LOSS = '#dc2626'; // Darker red for tooltips
            this.COLOR_TOOLTIP_INFO = '#2563eb'; // Darker blue for tooltips
            this.COLOR_TOOLTIP_WARNING = '#ea580c'; // Darker orange for tooltips

            // General colors
            this.COLOR_TEXT_PRIMARY = '#ffffff'; // Primary text color
            this.COLOR_TEXT_SECONDARY = '#888888'; // Secondary text color
            this.COLOR_BORDER = '#444444'; // Border color
            this.COLOR_GOLD = '#ffa500'; // Gold/currency color
            this.COLOR_ACCENT = '#22c55e'; // Script accent color (green)
            this.COLOR_REMAINING_XP = '#FFFFFF'; // Remaining XP text color
            this.COLOR_XP_RATE = '#ffffff'; // XP/hr rate text color
            this.COLOR_INV_COUNT = '#ffffff'; // Inventory count display color

            // Legacy color constants (mapped to COLOR_ACCENT)
            this.SCRIPT_COLOR_MAIN = this.COLOR_ACCENT;
            this.SCRIPT_COLOR_TOOLTIP = this.COLOR_ACCENT;
            this.SCRIPT_COLOR_ALERT = 'red';

            // Market API URL
            this.MARKET_API_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

            // Settings loaded from settings-schema via settings-storage.js
            this.settingsMap = {};

            // Map of setting keys to callback functions
            this.settingChangeCallbacks = {};

            // Feature toggles with metadata for future UI
            this.features = {
                // 市场功能 (Market Features)
                tooltipPrices: {
                    enabled: true,
                    name: '物品提示显示市场价',
                    category: '市场',
                    description: '在物品悬浮提示中显示买一/卖一价格',
                    settingKey: 'itemTooltip_prices',
                },
                tooltipProfit: {
                    enabled: true,
                    name: '物品提示显示利润计算器',
                    category: '市场',
                    description: '在物品悬浮提示中显示生产成本和利润',
                    settingKey: 'itemTooltip_profit',
                },
                tooltipConsumables: {
                    enabled: true,
                    name: '物品提示显示消耗品效果',
                    category: '市场',
                    description: '显示食物/饮料的增益效果和持续时间',
                    settingKey: 'showConsumTips',
                },
                expectedValueCalculator: {
                    enabled: true,
                    name: '预期价值计算器',
                    category: '市场',
                    description: '显示可开启容器（板框、宝箱）的预期价值 (EV)',
                    settingKey: 'itemTooltip_expectedValue',
                },
                market_showListingPrices: {
                    enabled: true,
                    name: '市场列表价格显示',
                    category: '市场',
                    description: '在“我的列表”中显示最高订单价、总价值和挂单时长',
                    settingKey: 'market_showListingPrices',
                },
                market_showEstimatedListingAge: {
                    enabled: true,
                    name: '预估挂单时长',
                    category: '市场',
                    description: '利用列表 ID 插值估算所有市场列表的创建时间',
                    settingKey: 'market_showEstimatedListingAge',
                },
                market_showOrderTotals: {
                    enabled: true,
                    name: '市场订单总额',
                    category: '市场',
                    description: '在顶部栏显示求购订单、出售订单和待领取金币总额',
                    settingKey: 'market_showOrderTotals',
                },
                market_showHistoryViewer: {
                    enabled: true,
                    name: '市场历史查看器',
                    category: '市场',
                    description: '查看并导出所有市场挂单历史记录',
                    settingKey: 'market_showHistoryViewer',
                },
                market_showPhiloCalculator: {
                    enabled: true,
                    name: 'Philo 赌狗计算器',
                    category: '市场',
                    description: "计算将物品转化为贤者之石 (Philosopher's Stones) 的预期价值",
                    settingKey: 'market_showPhiloCalculator',
                },

                // 动作功能 (Action Features)
                actionTimeDisplay: {
                    enabled: true,
                    name: '动作队列时间显示',
                    category: '动作',
                    description: '显示队列中动作的总时间和预计完成时间',
                    settingKey: 'totalActionTime',
                },
                quickInputButtons: {
                    enabled: true,
                    name: '快捷输入按钮',
                    category: '动作',
                    description: '在动作输入框添加 1/10/100/1000 快速选择按钮',
                    settingKey: 'actionPanel_totalTime_quickInputs',
                },
                actionPanelProfit: {
                    enabled: true,
                    name: '动作利润显示',
                    category: '动作',
                    description: '显示采集和生产动作的利润/亏损情况',
                    settingKey: 'actionPanel_foragingTotal',
                },
                requiredMaterials: {
                    enabled: true,
                    name: '所需材料显示',
                    category: '动作',
                    description: '显示生产动作所需的材料总量及缺失数量',
                    settingKey: 'requiredMaterials',
                },

                // 战斗功能 (Combat Features)
                abilityBookCalculator: {
                    enabled: true,
                    name: '技能书需求计算',
                    category: '战斗',
                    description: '显示到达目标等级所需的技能书数量',
                    settingKey: 'skillbook',
                },
                zoneIndices: {
                    enabled: true,
                    name: '战斗区域索引',
                    category: '战斗',
                    description: '在战斗地点列表中显示区域编号',
                    settingKey: 'mapIndex',
                },
                taskZoneIndices: {
                    enabled: true,
                    name: '任务区域索引',
                    category: '任务',
                    description: '在战斗任务上显示区域编号',
                    settingKey: 'taskMapIndex',
                },
                combatScore: {
                    enabled: true,
                    name: '个人资料装备评分',
                    category: '战斗',
                    description: '在个人资料界面显示装备评分 (Gear Score)',
                    settingKey: 'combatScore',
                },
                dungeonTracker: {
                    enabled: true,
                    name: '副本追踪器',
                    category: '战斗',
                    description: '在顶部栏实时追踪副本进度，包含波数时间、统计数据及组队频道完成消息',
                    settingKey: 'dungeonTracker',
                },
                combatSimIntegration: {
                    enabled: true,
                    name: '战斗模拟器集成',
                    category: '战斗',
                    description: '自动将角色/队伍数据导入 Shykai 战斗模拟器',
                    settingKey: null, // 新功能，无旧版设置键
                },
                enhancementSimulator: {
                    enabled: true,
                    name: '强化模拟器',
                    category: '市场',
                    description: '在物品提示中显示强化成本计算结果',
                    settingKey: 'enhanceSim',
                },

                // UI 功能 (UI Features)
                equipmentLevelDisplay: {
                    enabled: true,
                    name: '图标显示装备等级',
                    category: 'UI',
                    description: '在装备图标上直接显示物品等级数字',
                    settingKey: 'itemIconLevel',
                },
                alchemyItemDimming: {
                    enabled: true,
                    name: '炼金物品变暗',
                    category: 'UI',
                    description: '变暗那些等级要求高于当前炼金等级的物品',
                    settingKey: 'alchemyItemDimming',
                },
                skillExperiencePercentage: {
                    enabled: true,
                    name: '技能经验百分比',
                    category: 'UI',
                    description: '在左侧边栏显示经验进度百分比',
                    settingKey: 'expPercentage',
                },
                largeNumberFormatting: {
                    enabled: true,
                    name: '使用 K/M/B 数字格式',
                    category: 'UI',
                    description: '将大数字显示为 1.5M 而非 1,500,000',
                    settingKey: 'formatting_useKMBFormat',
                },

                // 任务功能 (Task Features)
                taskProfitDisplay: {
                    enabled: true,
                    name: '任务利润计算器',
                    category: '任务',
                    description: '显示任务奖励的预期利润',
                    settingKey: 'taskProfitCalculator',
                },
                taskEfficiencyRating: {
                    enabled: true,
                    name: '任务效率评分',
                    category: '任务',
                    description: '在任务卡片上显示每小时代币产出或利润',
                    settingKey: 'taskEfficiencyRating',
                },
                taskRerollTracker: {
                    enabled: true,
                    name: '任务刷新追踪器',
                    category: '任务',
                    description: '追踪任务刷新的成本和历史记录',
                    settingKey: 'taskRerollTracker',
                },
                taskSorter: {
                    enabled: true,
                    name: '任务排序',
                    category: '任务',
                    description: '添加按技能类型对任务进行排序的按钮',
                    settingKey: 'taskSorter',
                },
                taskIcons: {
                    enabled: true,
                    name: '任务图标',
                    category: '任务',
                    description: '在任务卡片上显示视觉图标',
                    settingKey: 'taskIcons',
                },
                taskIconsDungeons: {
                    enabled: false,
                    name: '任务图标 - 副本',
                    category: '任务',
                    description: '在战斗任务上显示该怪物所属的副本图标',
                    settingKey: 'taskIconsDungeons',
                    dependencies: ['taskIcons'],
                },

                // 技能功能 (Skills Features)
                skillRemainingXP: {
                    enabled: true,
                    name: '剩余 XP 显示',
                    category: '技能',
                    description: '在技能栏上显示距离下一级所需的 XP',
                    settingKey: 'skillRemainingXP',
                },

                // 房屋功能 (House Features)
                houseCostDisplay: {
                    enabled: true,
                    name: '房屋升级成本',
                    category: '房屋',
                    description: '显示升级材料的市场总价值',
                    settingKey: 'houseUpgradeCosts',
                },

                // 经济功能 (Economy Features)
                networth: {
                    enabled: true,
                    name: '净资产计算器',
                    category: '经济',
                    description: '在顶部栏显示总资产价值 (流动资产)',
                    settingKey: 'networth',
                },
                inventorySummary: {
                    enabled: true,
                    name: '库存统计面板',
                    category: '经济',
                    description: '在库存下方显示详细的净资产细分',
                    settingKey: 'invWorth',
                },
                inventorySort: {
                    enabled: true,
                    name: '库存排序',
                    category: '经济',
                    description: '按买一/卖一价格对库存进行排序',
                    settingKey: 'invSort',
                },
                inventorySortBadges: {
                    enabled: false,
                    name: '库存排序价格徽章',
                    category: '经济',
                    description: '排序时在物品上显示堆叠总价徽章',
                    settingKey: 'invSort_showBadges',
                },
                inventoryBadgePrices: {
                    enabled: false,
                    name: '库存价格徽章',
                    category: '经济',
                    description: '在物品上显示堆叠总价徽章（独立于排序功能）',
                    settingKey: 'invBadgePrices',
                },

                // 强化功能 (Enhancement Features)
                enhancementTracker: {
                    enabled: false,
                    name: '强化追踪器',
                    category: '强化',
                    description: '追踪强化的尝试次数、成本和统计数据',
                    settingKey: 'enhancementTracker',
                },

                // 通知功能 (Notification Features)
                notifiEmptyAction: {
                    enabled: false,
                    name: '空队列通知',
                    category: '通知',
                    description: '当动作队列变为空时发送浏览器通知',
                    settingKey: 'notifiEmptyAction',
                },
            };

            // Note: loadSettings() must be called separately (async)
        }

        /**
         * Initialize config (async) - loads settings from storage
         * @returns {Promise<void>}
         */
        async initialize() {
            await this.loadSettings();
            this.applyColorSettings();
        }

        /**
         * Load settings from storage (async)
         * @returns {Promise<void>}
         */
        async loadSettings() {
            // Set character ID in settings storage for per-character settings
            const characterId = dataManager.getCurrentCharacterId();
            if (characterId) {
                settingsStorage.setCharacterId(characterId);
            }

            // Load settings from settings-storage (which uses settings-schema as source of truth)
            this.settingsMap = await settingsStorage.loadSettings();
        }

        /**
         * Clear settings cache (for character switching)
         */
        clearSettingsCache() {
            this.settingsMap = {};
        }

        /**
         * Save settings to storage (immediately)
         */
        saveSettings() {
            settingsStorage.saveSettings(this.settingsMap);
        }

        /**
         * Get a setting value
         * @param {string} key - Setting key
         * @returns {boolean} Setting value
         */
        getSetting(key) {
            // Check loaded settings first
            if (this.settingsMap[key]) {
                return this.settingsMap[key].isTrue ?? false;
            }

            // Fallback: Check settings-schema for default (fixes race condition on load)
            for (const group of Object.values(settingsGroups)) {
                if (group.settings[key]) {
                    return group.settings[key].default ?? false;
                }
            }

            // Ultimate fallback
            return false;
        }

        /**
         * Get a setting value (for non-boolean settings)
         * @param {string} key - Setting key
         * @param {*} defaultValue - Default value if key doesn't exist
         * @returns {*} Setting value
         */
        getSettingValue(key, defaultValue = null) {
            const setting = this.settingsMap[key];
            if (!setting) {
                return defaultValue;
            }
            // Handle both boolean (isTrue) and value-based settings
            if (setting.hasOwnProperty('value')) {
                let value = setting.value;

                // Parse JSON strings for template-type settings
                if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
                    try {
                        value = JSON.parse(value);
                    } catch (e) {
                        console.warn(`[Config] Failed to parse JSON for setting '${key}':`, e);
                        // Return as-is if parsing fails
                    }
                }

                return value;
            } else if (setting.hasOwnProperty('isTrue')) {
                return setting.isTrue;
            }
            return defaultValue;
        }

        /**
         * Set a setting value (auto-saves)
         * @param {string} key - Setting key
         * @param {boolean} value - Setting value
         */
        setSetting(key, value) {
            if (this.settingsMap[key]) {
                this.settingsMap[key].isTrue = value;
                this.saveSettings();

                // Re-apply colors if color setting changed
                if (key === 'useOrangeAsMainColor') {
                    this.applyColorSettings();
                }

                // Trigger registered callbacks for this setting
                if (this.settingChangeCallbacks[key]) {
                    this.settingChangeCallbacks[key](value);
                }
            }
        }

        /**
         * Set a setting value (for non-boolean settings, auto-saves)
         * @param {string} key - Setting key
         * @param {*} value - Setting value
         */
        setSettingValue(key, value) {
            if (this.settingsMap[key]) {
                this.settingsMap[key].value = value;
                this.saveSettings();

                // Re-apply color settings if this is a color setting
                if (key.startsWith('color_')) {
                    this.applyColorSettings();
                }

                // Trigger registered callbacks for this setting
                if (this.settingChangeCallbacks[key]) {
                    this.settingChangeCallbacks[key](value);
                }
            }
        }

        /**
         * Register a callback to be called when a specific setting changes
         * @param {string} key - Setting key to watch
         * @param {Function} callback - Callback function to call when setting changes
         */
        onSettingChange(key, callback) {
            this.settingChangeCallbacks[key] = callback;
        }

        /**
         * Unregister a callback for a specific setting change
         * @param {string} key - Setting key to stop watching
         * @param {Function} _callback - Callback function to remove (unused, kept for API consistency)
         */
        offSettingChange(key, _callback) {
            delete this.settingChangeCallbacks[key];
        }

        /**
         * Toggle a setting (auto-saves)
         * @param {string} key - Setting key
         * @returns {boolean} New value
         */
        toggleSetting(key) {
            const newValue = !this.getSetting(key);
            this.setSetting(key, newValue);
            return newValue;
        }

        /**
         * Get all settings as an array (useful for UI)
         * @returns {Array} Array of setting objects
         */
        getAllSettings() {
            return Object.values(this.settingsMap);
        }

        /**
         * Reset all settings to defaults
         */
        resetToDefaults() {
            // Find default values from constructor (all true except notifiEmptyAction)
            for (const key in this.settingsMap) {
                this.settingsMap[key].isTrue = key !== 'notifiEmptyAction';
            }

            this.saveSettings();
            this.applyColorSettings();
        }

        /**
         * Sync current settings to all other characters
         * @returns {Promise<{success: boolean, count: number, error?: string}>} Result object
         */
        async syncSettingsToAllCharacters() {
            try {
                // Ensure character ID is set
                const characterId = dataManager.getCurrentCharacterId();
                if (!characterId) {
                    return {
                        success: false,
                        count: 0,
                        error: 'No character ID available',
                    };
                }

                // Set character ID in settings storage
                settingsStorage.setCharacterId(characterId);

                // Sync settings to all other characters
                const syncedCount = await settingsStorage.syncSettingsToAllCharacters(this.settingsMap);

                return {
                    success: true,
                    count: syncedCount,
                };
            } catch (error) {
                console.error('[Config] Failed to sync settings:', error);
                return {
                    success: false,
                    count: 0,
                    error: error.message,
                };
            }
        }

        /**
         * Get number of known characters (including current)
         * @returns {Promise<number>} Number of characters
         */
        async getKnownCharacterCount() {
            try {
                const knownCharacters = await settingsStorage.getKnownCharacters();
                return knownCharacters.length;
            } catch (error) {
                console.error('[Config] Failed to get character count:', error);
                return 0;
            }
        }

        /**
         * Apply color settings to color constants
         */
        applyColorSettings() {
            // Apply extended color palette from settings
            this.COLOR_PROFIT = this.getSettingValue('color_profit', '#047857');
            this.COLOR_LOSS = this.getSettingValue('color_loss', '#f87171');
            this.COLOR_WARNING = this.getSettingValue('color_warning', '#ffa500');
            this.COLOR_INFO = this.getSettingValue('color_info', '#60a5fa');
            this.COLOR_ESSENCE = this.getSettingValue('color_essence', '#c084fc');
            this.COLOR_TOOLTIP_PROFIT = this.getSettingValue('color_tooltip_profit', '#047857');
            this.COLOR_TOOLTIP_LOSS = this.getSettingValue('color_tooltip_loss', '#dc2626');
            this.COLOR_TOOLTIP_INFO = this.getSettingValue('color_tooltip_info', '#2563eb');
            this.COLOR_TOOLTIP_WARNING = this.getSettingValue('color_tooltip_warning', '#ea580c');
            this.COLOR_TEXT_PRIMARY = this.getSettingValue('color_text_primary', '#ffffff');
            this.COLOR_TEXT_SECONDARY = this.getSettingValue('color_text_secondary', '#888888');
            this.COLOR_BORDER = this.getSettingValue('color_border', '#444444');
            this.COLOR_GOLD = this.getSettingValue('color_gold', '#ffa500');
            this.COLOR_ACCENT = this.getSettingValue('color_accent', '#22c55e');
            this.COLOR_REMAINING_XP = this.getSettingValue('color_remaining_xp', '#FFFFFF');
            this.COLOR_XP_RATE = this.getSettingValue('color_xp_rate', '#ffffff');
            this.COLOR_INV_COUNT = this.getSettingValue('color_inv_count', '#ffffff');
            this.COLOR_INVBADGE_ASK = this.getSettingValue('color_invBadge_ask', '#047857');
            this.COLOR_INVBADGE_BID = this.getSettingValue('color_invBadge_bid', '#60a5fa');
            this.COLOR_TRANSMUTE = this.getSettingValue('color_transmute', '#ffffff');

            // Set legacy SCRIPT_COLOR_MAIN to accent color
            this.SCRIPT_COLOR_MAIN = this.COLOR_ACCENT;
            this.SCRIPT_COLOR_TOOLTIP = this.COLOR_ACCENT; // Keep tooltip same as main
        }

        /**
         * Check if a feature is enabled
         * Uses legacy settingKey if available, otherwise uses feature.enabled
         * @param {string} featureKey - Feature key (e.g., 'tooltipPrices')
         * @returns {boolean} Whether feature is enabled
         */
        isFeatureEnabled(featureKey) {
            const feature = this.features?.[featureKey];
            if (!feature) {
                return true; // Default to enabled if not found
            }

            // Check legacy setting first (for backward compatibility)
            if (feature.settingKey && this.settingsMap[feature.settingKey]) {
                return this.settingsMap[feature.settingKey].isTrue ?? true;
            }

            // Otherwise use feature.enabled
            return feature.enabled ?? true;
        }

        /**
         * Enable or disable a feature
         * @param {string} featureKey - Feature key
         * @param {boolean} enabled - Enable state
         */
        async setFeatureEnabled(featureKey, enabled) {
            const feature = this.features?.[featureKey];
            if (!feature) {
                console.warn(`Feature '${featureKey}' not found`);
                return;
            }

            // Update legacy setting if it exists
            if (feature.settingKey && this.settingsMap[feature.settingKey]) {
                this.settingsMap[feature.settingKey].isTrue = enabled;
            }

            // Update feature registry
            feature.enabled = enabled;

            await this.saveSettings();
        }

        /**
         * Toggle a feature
         * @param {string} featureKey - Feature key
         * @returns {boolean} New enabled state
         */
        async toggleFeature(featureKey) {
            const current = this.isFeatureEnabled(featureKey);
            await this.setFeatureEnabled(featureKey, !current);
            return !current;
        }

        /**
         * Get all features grouped by category
         * @returns {Object} Features grouped by category
         */
        getFeaturesByCategory() {
            const grouped = {};

            for (const [key, feature] of Object.entries(this.features)) {
                const category = feature.category || 'Other';
                if (!grouped[category]) {
                    grouped[category] = [];
                }
                grouped[category].push({
                    key,
                    name: feature.name,
                    description: feature.description,
                    enabled: this.isFeatureEnabled(key),
                });
            }

            return grouped;
        }

        /**
         * Get all feature keys
         * @returns {string[]} Array of feature keys
         */
        getFeatureKeys() {
            return Object.keys(this.features || {});
        }

        /**
         * Get feature info
         * @param {string} featureKey - Feature key
         * @returns {Object|null} Feature info with current enabled state
         */
        getFeatureInfo(featureKey) {
            const feature = this.features?.[featureKey];
            if (!feature) {
                return null;
            }

            return {
                key: featureKey,
                name: feature.name,
                category: feature.category,
                description: feature.description,
                enabled: this.isFeatureEnabled(featureKey),
            };
        }
    }

    const config = new Config();

    /**
     * Centralized DOM Observer
     * Single MutationObserver that dispatches to registered handlers
     * Replaces 15 separate observers watching document.body
     * Supports optional debouncing to reduce CPU usage during bulk DOM changes
     */

    class DOMObserver {
        constructor() {
            this.observer = null;
            this.handlers = [];
            this.isObserving = false;
            this.debounceTimers = new Map(); // Track debounce timers per handler
            this.debouncedElements = new Map(); // Track pending elements per handler
            this.DEFAULT_DEBOUNCE_DELAY = 50; // 50ms default delay
        }

        /**
         * Start observing DOM changes
         */
        start() {
            if (this.isObserving) return;

            // Wait for document.body to exist (critical for @run-at document-start)
            const startObserver = () => {
                if (!document.body) {
                    // Body doesn't exist yet, wait and try again
                    setTimeout(startObserver, 10);
                    return;
                }

                this.observer = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType !== Node.ELEMENT_NODE) continue;

                            // Dispatch to all registered handlers
                            this.handlers.forEach((handler) => {
                                try {
                                    if (handler.debounce) {
                                        this.debouncedCallback(handler, node, mutation);
                                    } else {
                                        handler.callback(node, mutation);
                                    }
                                } catch (error) {
                                    console.error(`[DOM Observer] Handler error (${handler.name}):`, error);
                                }
                            });
                        }
                    }
                });

                this.observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                });

                this.isObserving = true;
            };

            startObserver();
        }

        /**
         * Debounced callback handler
         * Collects elements and fires callback after delay
         * @private
         */
        debouncedCallback(handler, node, mutation) {
            const handlerName = handler.name;
            const delay = handler.debounceDelay || this.DEFAULT_DEBOUNCE_DELAY;

            // Store element for batched processing
            if (!this.debouncedElements.has(handlerName)) {
                this.debouncedElements.set(handlerName, []);
            }
            this.debouncedElements.get(handlerName).push({ node, mutation });

            // Clear existing timer
            if (this.debounceTimers.has(handlerName)) {
                clearTimeout(this.debounceTimers.get(handlerName));
            }

            // Set new timer
            const timer = setTimeout(() => {
                const elements = this.debouncedElements.get(handlerName) || [];
                this.debouncedElements.delete(handlerName);
                this.debounceTimers.delete(handlerName);

                // Process all collected elements
                // For most handlers, we only need to process the last element
                // (e.g., task list updated multiple times, we only care about final state)
                if (elements.length > 0) {
                    const lastElement = elements[elements.length - 1];
                    handler.callback(lastElement.node, lastElement.mutation);
                }
            }, delay);

            this.debounceTimers.set(handlerName, timer);
        }

        /**
         * Stop observing DOM changes
         */
        stop() {
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }

            // Clear all debounce timers
            this.debounceTimers.forEach((timer) => clearTimeout(timer));
            this.debounceTimers.clear();
            this.debouncedElements.clear();

            this.isObserving = false;
        }

        /**
         * Register a handler for DOM changes
         * @param {string} name - Handler name for debugging
         * @param {Function} callback - Function to call when nodes are added (receives node, mutation)
         * @param {Object} options - Optional configuration
         * @param {boolean} options.debounce - Enable debouncing (default: false)
         * @param {number} options.debounceDelay - Debounce delay in ms (default: 50)
         * @returns {Function} Unregister function
         */
        register(name, callback, options = {}) {
            const handler = {
                name,
                callback,
                debounce: options.debounce || false,
                debounceDelay: options.debounceDelay,
            };
            this.handlers.push(handler);

            // Return unregister function
            return () => {
                const index = this.handlers.indexOf(handler);
                if (index > -1) {
                    this.handlers.splice(index, 1);

                    // Clean up any pending debounced callbacks
                    if (this.debounceTimers.has(name)) {
                        clearTimeout(this.debounceTimers.get(name));
                        this.debounceTimers.delete(name);
                        this.debouncedElements.delete(name);
                    }
                }
            };
        }

        /**
         * Register a handler for specific class names
         * @param {string} name - Handler name for debugging
         * @param {string|string[]} classNames - Class name(s) to watch for (supports partial matches)
         * @param {Function} callback - Function to call when matching elements appear
         * @param {Object} options - Optional configuration
         * @param {boolean} options.debounce - Enable debouncing (default: false for immediate response)
         * @param {number} options.debounceDelay - Debounce delay in ms (default: 50)
         * @returns {Function} Unregister function
         */
        onClass(name, classNames, callback, options = {}) {
            const classArray = Array.isArray(classNames) ? classNames : [classNames];

            return this.register(
                name,
                (node) => {
                    // Safely get className as string (handles SVG elements)
                    const className = typeof node.className === 'string' ? node.className : '';

                    // Check if node matches any of the target classes
                    for (const targetClass of classArray) {
                        if (className.includes(targetClass)) {
                            callback(node);
                            return; // Only call once per node
                        }
                    }

                    // Also check if node contains matching elements
                    if (node.querySelector) {
                        for (const targetClass of classArray) {
                            const matches = node.querySelectorAll(`[class*="${targetClass}"]`);
                            matches.forEach((match) => callback(match));
                        }
                    }
                },
                options
            );
        }

        /**
         * Get stats about registered handlers
         */
        getStats() {
            return {
                isObserving: this.isObserving,
                handlerCount: this.handlers.length,
                handlers: this.handlers.map((h) => ({
                    name: h.name,
                    debounced: h.debounce || false,
                })),
                pendingCallbacks: this.debounceTimers.size,
            };
        }
    }

    const domObserver = new DOMObserver();

    /**
     * Feature Registry
     * Centralized feature initialization system
     */


    /**
     * Feature Registry
     * Populated at runtime by the entrypoint to avoid bundling feature code in core.
     */
    const featureRegistry = [];

    /**
     * Initialize all enabled features
     * @returns {Promise<void>}
     */
    async function initializeFeatures() {
        // Block feature initialization during character switch
        if (dataManager.getIsCharacterSwitching()) {
            return;
        }

        const errors = [];

        for (const feature of featureRegistry) {
            try {
                const isEnabled = feature.customCheck ? feature.customCheck() : config.isFeatureEnabled(feature.key);

                if (!isEnabled) {
                    continue;
                }

                // Initialize feature
                if (feature.async) {
                    await feature.initialize();
                } else {
                    feature.initialize();
                }
            } catch (error) {
                errors.push({
                    feature: feature.name,
                    error: error.message,
                });
                console.error(`[Toolasha] Failed to initialize ${feature.name}:`, error);
            }
        }

        // Log errors if any occurred
        if (errors.length > 0) {
            console.error(`[Toolasha] ${errors.length} feature(s) failed to initialize`, errors);
        }
    }

    /**
     * Get feature by key
     * @param {string} key - Feature key
     * @returns {Object|null} Feature definition or null
     */
    function getFeature(key) {
        return featureRegistry.find((f) => f.key === key) || null;
    }

    /**
     * Get all features
     * @returns {Array} Feature registry
     */
    function getAllFeatures() {
        return [...featureRegistry];
    }

    /**
     * Get features by category
     * @param {string} category - Category name
     * @returns {Array} Features in category
     */
    function getFeaturesByCategory(category) {
        return featureRegistry.filter((f) => f.category === category);
    }

    /**
     * Check health of all initialized features
     * @returns {Array<Object>} Array of failed features with details
     */
    function checkFeatureHealth() {
        const failed = [];

        for (const feature of featureRegistry) {
            // Skip if feature has no health check
            if (!feature.healthCheck) continue;

            // Skip if feature is not enabled
            const isEnabled = feature.customCheck ? feature.customCheck() : config.isFeatureEnabled(feature.key);

            if (!isEnabled) continue;

            try {
                const result = feature.healthCheck();

                // null = can't verify (DOM not ready), false = failed, true = healthy
                if (result === false) {
                    failed.push({
                        key: feature.key,
                        name: feature.name,
                        reason: 'Health check returned false',
                    });
                }
            } catch (error) {
                failed.push({
                    key: feature.key,
                    name: feature.name,
                    reason: `Health check error: ${error.message}`,
                });
            }
        }

        return failed;
    }

    /**
     * Setup character switch handler
     * Re-initializes all features when character switches
     */
    function setupCharacterSwitchHandler() {
        // Promise that resolves when cleanup is complete
        let cleanupPromise = null;
        let reinitScheduled = false;

        // Handle character_switching event (cleanup phase)
        dataManager.on('character_switching', async (_data) => {
            cleanupPromise = (async () => {
                try {
                    // Clear config cache IMMEDIATELY to prevent stale settings
                    if (config && typeof config.clearSettingsCache === 'function') {
                        config.clearSettingsCache();
                    }

                    // Disable all active features (cleanup DOM elements, event listeners, etc.)
                    const cleanupPromises = [];
                    for (const feature of featureRegistry) {
                        try {
                            const featureInstance = getFeatureInstance(feature.key);
                            if (featureInstance && typeof featureInstance.disable === 'function') {
                                const result = featureInstance.disable();
                                if (result && typeof result.then === 'function') {
                                    cleanupPromises.push(
                                        result.catch((error) => {
                                            console.error(`[FeatureRegistry] Failed to disable ${feature.name}:`, error);
                                        })
                                    );
                                }
                            }
                        } catch (error) {
                            console.error(`[FeatureRegistry] Failed to disable ${feature.name}:`, error);
                        }
                    }

                    // Wait for all cleanup in parallel
                    if (cleanupPromises.length > 0) {
                        await Promise.all(cleanupPromises);
                    }
                } catch (error) {
                    console.error('[FeatureRegistry] Error during character switch cleanup:', error);
                }
            })();

            await cleanupPromise;
        });

        // Handle character_switched event (re-initialization phase)
        dataManager.on('character_switched', async (_data) => {
            // Prevent multiple overlapping reinits
            if (reinitScheduled) {
                return;
            }

            reinitScheduled = true;

            // Force cleanup of dungeon tracker UI (safety measure)
            const dungeonTrackerFeature = getFeature('dungeonTrackerUI');
            if (dungeonTrackerFeature && typeof dungeonTrackerFeature.cleanup === 'function') {
                dungeonTrackerFeature.cleanup();
            }

            try {
                // Wait for cleanup to complete (with safety timeout)
                if (cleanupPromise) {
                    await Promise.race([cleanupPromise, new Promise((resolve) => setTimeout(resolve, 500))]);
                }

                // CRITICAL: Load settings BEFORE any feature initialization
                // This ensures all features see the new character's settings
                await config.loadSettings();
                config.applyColorSettings();

                // Small delay to ensure game state is stable
                await new Promise((resolve) => setTimeout(resolve, 50));

                // Now re-initialize all features with fresh settings
                await initializeFeatures();
            } catch (error) {
                console.error('[FeatureRegistry] Error during feature reinitialization:', error);
            } finally {
                reinitScheduled = false;
            }
        });
    }

    /**
     * Get feature instance from imported module
     * @param {string} key - Feature key
     * @returns {Object|null} Feature instance or null
     * @private
     */
    function getFeatureInstance(key) {
        const feature = getFeature(key);
        if (!feature) {
            return null;
        }

        return feature.module || feature;
    }

    /**
     * Retry initialization for specific features
     * @param {Array<Object>} failedFeatures - Array of failed feature objects
     * @returns {Promise<void>}
     */
    async function retryFailedFeatures(failedFeatures) {
        for (const failed of failedFeatures) {
            const feature = getFeature(failed.key);
            if (!feature) continue;

            try {
                if (feature.async) {
                    await feature.initialize();
                } else {
                    feature.initialize();
                }

                // Verify the retry actually worked by running health check
                if (feature.healthCheck) {
                    const healthResult = feature.healthCheck();
                    if (healthResult === false) {
                        console.warn(`[Toolasha] ${feature.name} retry completed but health check still fails`);
                    }
                }
            } catch (error) {
                console.error(`[Toolasha] ${feature.name} retry failed:`, error);
            }
        }
    }

    /**
     * Replace the feature registry (for library split)
     * @param {Array} newFeatures - New feature registry array
     */
    function replaceFeatures(newFeatures) {
        featureRegistry.length = 0; // Clear existing array
        featureRegistry.push(...newFeatures); // Add new features
    }

    var featureRegistry$1 = {
        initializeFeatures,
        setupCharacterSwitchHandler,
        checkFeatureHealth,
        retryFailedFeatures,
        getFeature,
        getAllFeatures,
        replaceFeatures,
        getFeaturesByCategory,
    };

    /**
     * Tooltip Observer
     * Centralized observer for tooltip/popper appearances
     * Any feature can subscribe to be notified when tooltips appear
     */


    class TooltipObserver {
        constructor() {
            this.subscribers = new Map(); // name -> callback
            this.unregisterObserver = null;
            this.isInitialized = false;
        }

        /**
         * Initialize the observer (call once)
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            this.isInitialized = true;

            // Watch for tooltip/popper elements appearing
            // These are the common classes used by MUI tooltips/poppers
            this.unregisterObserver = domObserver.onClass('TooltipObserver', ['MuiPopper', 'MuiTooltip'], (element) => {
                this.notifySubscribers(element);
            });
        }

        /**
         * Subscribe to tooltip appearance events
         * @param {string} name - Unique subscriber name
         * @param {Function} callback - Function(element) to call when tooltip appears
         */
        subscribe(name, callback) {
            this.subscribers.set(name, callback);

            // Auto-initialize if first subscriber
            if (!this.isInitialized) {
                this.initialize();
            }
        }

        /**
         * Unsubscribe from tooltip events
         * @param {string} name - Subscriber name
         */
        unsubscribe(name) {
            this.subscribers.delete(name);

            // If no subscribers left, could optionally stop observing
            // For now, keep observer active for simplicity
        }

        /**
         * Notify all subscribers that a tooltip appeared
         * @param {Element} element - The tooltip/popper element
         * @private
         */
        notifySubscribers(element) {
            // Set up observer to detect when this specific tooltip is removed
            const removalObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const removedNode of mutation.removedNodes) {
                        if (removedNode === element) {
                            // Notify subscribers that tooltip closed
                            for (const [name, callback] of this.subscribers.entries()) {
                                try {
                                    callback(element, 'closed');
                                } catch (error) {
                                    console.error(`[TooltipObserver] Error in subscriber "${name}" (close):`, error);
                                }
                            }
                            removalObserver.disconnect();
                            return;
                        }
                    }
                }
            });

            // Watch the parent for removal of this tooltip
            if (element.parentNode) {
                removalObserver.observe(element.parentNode, {
                    childList: true,
                });
            }

            // Notify subscribers that tooltip opened
            for (const [name, callback] of this.subscribers.entries()) {
                try {
                    callback(element, 'opened');
                } catch (error) {
                    console.error(`[TooltipObserver] Error in subscriber "${name}" (open):`, error);
                }
            }
        }

        /**
         * Cleanup and disable
         */
        disable() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }
            this.subscribers.clear();
            this.isInitialized = false;
        }
    }

    const tooltipObserver = new TooltipObserver();

    /**
     * Network Alert Display
     * Shows a warning message when market data cannot be fetched
     */


    class NetworkAlert {
        constructor() {
            this.container = null;
            this.unregisterHandlers = [];
            this.isVisible = false;
        }

        /**
         * Initialize network alert display
         */
        initialize() {
            if (!config.getSetting('networkAlert')) {
                return;
            }

            // 1. Check if header exists already
            const existingElem = document.querySelector('[class*="Header_totalLevel"]');
            if (existingElem) {
                this.prepareContainer(existingElem);
            }

            // 2. Watch for header to appear (handles SPA navigation)
            const unregister = domObserver.onClass('NetworkAlert', 'Header_totalLevel', (elem) => {
                this.prepareContainer(elem);
            });
            this.unregisterHandlers.push(unregister);
        }

        /**
         * Prepare container but don't show yet
         * @param {Element} totalLevelElem - Total level element
         */
        prepareContainer(totalLevelElem) {
            // Check if already prepared
            if (this.container && document.body.contains(this.container)) {
                return;
            }

            // Remove any existing container
            if (this.container) {
                this.container.remove();
            }

            // Create container (hidden by default)
            this.container = document.createElement('div');
            this.container.className = 'mwi-network-alert';
            this.container.style.cssText = `
            display: none;
            font-size: 0.875rem;
            font-weight: 500;
            color: #ff4444;
            text-wrap: nowrap;
            margin-left: 16px;
        `;

            // Insert after total level (or after networth if it exists)
            const networthElem = totalLevelElem.parentElement.querySelector('.mwi-networth-header');
            if (networthElem) {
                networthElem.insertAdjacentElement('afterend', this.container);
            } else {
                totalLevelElem.insertAdjacentElement('afterend', this.container);
            }
        }

        /**
         * Show the network alert
         * @param {string} message - Alert message to display
         */
        show(message = '⚠️ Market data unavailable') {
            if (!config.getSetting('networkAlert')) {
                return;
            }

            if (!this.container || !document.body.contains(this.container)) {
                // Try to prepare container if not ready
                const totalLevelElem = document.querySelector('[class*="Header_totalLevel"]');
                if (totalLevelElem) {
                    this.prepareContainer(totalLevelElem);
                } else {
                    // Header not found, fallback to console
                    console.warn('[Network Alert]', message);
                    return;
                }
            }

            if (this.container) {
                this.container.textContent = message;
                this.container.style.display = 'block';
                this.isVisible = true;
            }
        }

        /**
         * Hide the network alert
         */
        hide() {
            if (this.container && document.body.contains(this.container)) {
                this.container.style.display = 'none';
                this.isVisible = false;
            }
        }

        /**
         * Cleanup
         */
        disable() {
            this.hide();

            if (this.container) {
                this.container.remove();
                this.container = null;
            }

            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];
        }
    }

    const networkAlert = new NetworkAlert();

    /**
     * Marketplace API Module
     * Fetches and caches market price data from the MWI marketplace API
     */


    /**
     * MarketAPI class handles fetching and caching market price data
     */
    class MarketAPI {
        constructor() {
            // API endpoint
            this.API_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

            // Cache settings
            this.CACHE_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds
            this.CACHE_KEY_DATA = 'Toolasha_marketAPI_json';
            this.CACHE_KEY_TIMESTAMP = 'Toolasha_marketAPI_timestamp';
            this.CACHE_KEY_PATCHES = 'Toolasha_marketAPI_patches';
            this.CACHE_KEY_MIGRATION = 'Toolasha_marketAPI_migration_version';
            this.CURRENT_MIGRATION_VERSION = 1; // Increment this when patches need to be cleared

            // Current market data
            this.marketData = null;
            this.lastFetchTimestamp = null;
            this.errorLog = [];

            // Price patches from order book data (fresher than API)
            // Structure: { "itemHrid:enhLevel": { a: ask, b: bid, timestamp: ms } }
            this.pricePatchs = {};

            // Event listeners for price updates
            this.listeners = [];
        }

        /**
         * Fetch market data from API or cache
         * @param {boolean} forceFetch - Force a fresh fetch even if cache is valid
         * @returns {Promise<Object|null>} Market data object or null if failed
         */
        async fetch(forceFetch = false) {
            // Check cache first (unless force fetch)
            if (!forceFetch) {
                const cached = await this.getCachedData();
                if (cached) {
                    this.marketData = cached.data;
                    // API timestamp is in seconds, convert to milliseconds for comparison with Date.now()
                    this.lastFetchTimestamp = cached.timestamp * 1000;
                    // Load patches from storage
                    await this.loadPatches();
                    // Hide alert on successful cache load
                    networkAlert.hide();
                    // Notify listeners (initial load)
                    this.notifyListeners();
                    return this.marketData;
                }
            }

            if (!connectionState.isConnected()) {
                const cachedFallback = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);
                if (cachedFallback?.marketData) {
                    this.marketData = cachedFallback.marketData;
                    // API timestamp is in seconds, convert to milliseconds
                    this.lastFetchTimestamp = cachedFallback.timestamp * 1000;
                    // Load patches from storage
                    await this.loadPatches();
                    console.warn('[MarketAPI] Skipping fetch; disconnected. Using cached data.');
                    return this.marketData;
                }

                console.warn('[MarketAPI] Skipping fetch; disconnected and no cache available');
                return null;
            }

            // Try to fetch fresh data
            try {
                const response = await this.fetchFromAPI();

                if (response) {
                    // Cache the fresh data
                    this.cacheData(response);
                    this.marketData = response.marketData;
                    // API timestamp is in seconds, convert to milliseconds
                    this.lastFetchTimestamp = response.timestamp * 1000;
                    // Load patches from storage (they may still be fresher than new API data)
                    await this.loadPatches();
                    // Hide alert on successful fetch
                    networkAlert.hide();
                    // Notify listeners of price update
                    this.notifyListeners();
                    return this.marketData;
                }
            } catch (error) {
                this.logError('Fetch failed', error);
            }

            // Fallback: Try to use expired cache
            const expiredCache = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);
            if (expiredCache) {
                console.warn('[MarketAPI] Using expired cache as fallback');
                this.marketData = expiredCache.marketData;
                // API timestamp is in seconds, convert to milliseconds
                this.lastFetchTimestamp = expiredCache.timestamp * 1000;
                // Load patches from storage
                await this.loadPatches();
                // Show alert when using expired cache
                networkAlert.show('⚠️ Using outdated market data');
                return this.marketData;
            }

            // Total failure - show alert
            console.error('[MarketAPI] ❌ No market data available');
            networkAlert.show('⚠️ Market data unavailable');
            return null;
        }

        /**
         * Fetch from API endpoint
         * @returns {Promise<Object|null>} API response or null
         */
        async fetchFromAPI() {
            try {
                const response = await fetch(this.API_URL);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();

                // Validate response structure
                if (!data.marketData || typeof data.marketData !== 'object') {
                    throw new Error('Invalid API response structure');
                }

                return data;
            } catch (error) {
                console.error('[MarketAPI] API fetch error:', error);
                throw error;
            }
        }

        /**
         * Get cached data if valid
         * @returns {Promise<Object|null>} { data, timestamp } or null if invalid/expired
         */
        async getCachedData() {
            const cachedTimestamp = await storage.get(this.CACHE_KEY_TIMESTAMP, 'settings', null);
            const cachedData = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);

            if (!cachedTimestamp || !cachedData) {
                return null;
            }

            // Check if cache is still valid
            const now = Date.now();
            const age = now - cachedTimestamp;

            if (age > this.CACHE_DURATION) {
                return null;
            }

            return {
                data: cachedData.marketData,
                timestamp: cachedData.timestamp,
            };
        }

        /**
         * Cache market data
         * @param {Object} data - API response to cache
         */
        cacheData(data) {
            storage.setJSON(this.CACHE_KEY_DATA, data, 'settings');
            storage.set(this.CACHE_KEY_TIMESTAMP, Date.now(), 'settings');
        }

        /**
         * Get price for an item
         * @param {string} itemHrid - Item HRID (e.g., "/items/cheese")
         * @param {number} enhancementLevel - Enhancement level (default: 0)
         * @returns {Object|null} { ask: number, bid: number } or null if not found
         */
        getPrice(itemHrid, enhancementLevel = 0) {
            const normalizeMarketPriceValue = (value) => {
                if (typeof value !== 'number') {
                    return null;
                }

                if (value < 0) {
                    return null;
                }

                return value;
            };

            // Check for fresh patch first
            const patchKey = `${itemHrid}:${enhancementLevel}`;
            const patch = this.pricePatchs[patchKey];

            if (patch && patch.timestamp > this.lastFetchTimestamp) {
                // Patch is fresher than API data - use it
                return {
                    ask: normalizeMarketPriceValue(patch.a),
                    bid: normalizeMarketPriceValue(patch.b),
                };
            }

            // Fall back to API data
            if (!this.marketData) {
                console.warn('[MarketAPI] ⚠️ No market data available');
                return null;
            }

            const priceData = this.marketData[itemHrid];

            if (!priceData || typeof priceData !== 'object') {
                // Item not in market data at all
                return null;
            }

            // Market data is organized by enhancement level
            // { 0: { a: 1000, b: 900 }, 2: { a: 5000, b: 4500 }, ... }
            const price = priceData[enhancementLevel];

            if (!price) {
                // No price data for this enhancement level
                return null;
            }

            return {
                ask: normalizeMarketPriceValue(price.a), // Sell price
                bid: normalizeMarketPriceValue(price.b), // Buy price
            };
        }

        /**
         * Get prices for multiple items
         * @param {string[]} itemHrids - Array of item HRIDs
         * @returns {Map<string, Object>} Map of HRID -> { ask, bid }
         */
        getPrices(itemHrids) {
            const prices = new Map();

            for (const hrid of itemHrids) {
                const price = this.getPrice(hrid);
                if (price) {
                    prices.set(hrid, price);
                }
            }

            return prices;
        }

        /**
         * Get prices for multiple items with enhancement levels (batch optimized)
         * @param {Array<{itemHrid: string, enhancementLevel: number}>} items - Array of items with enhancement levels
         * @returns {Map<string, Object>} Map of "hrid:level" -> { ask, bid }
         */
        getPricesBatch(items) {
            const priceMap = new Map();

            for (const { itemHrid, enhancementLevel = 0 } of items) {
                const key = `${itemHrid}:${enhancementLevel}`;
                if (!priceMap.has(key)) {
                    const price = this.getPrice(itemHrid, enhancementLevel);
                    if (price) {
                        priceMap.set(key, price);
                    }
                }
            }

            return priceMap;
        }

        /**
         * Check if market data is loaded
         * @returns {boolean} True if data is available
         */
        isLoaded() {
            return this.marketData !== null;
        }

        /**
         * Get age of current data in milliseconds
         * @returns {number|null} Age in ms or null if no data
         */
        getDataAge() {
            if (!this.lastFetchTimestamp) {
                return null;
            }

            return Date.now() - this.lastFetchTimestamp;
        }

        /**
         * Log an error
         * @param {string} message - Error message
         * @param {Error} error - Error object
         */
        logError(message, error) {
            const errorEntry = {
                timestamp: new Date().toISOString(),
                message,
                error: error?.message || String(error),
            };

            this.errorLog.push(errorEntry);
            console.error(`[MarketAPI] ${message}:`, error);
        }

        /**
         * Get error log
         * @returns {Array} Array of error entries
         */
        getErrors() {
            return [...this.errorLog];
        }

        /**
         * Clear error log
         */
        clearErrors() {
            this.errorLog = [];
        }

        /**
         * Update price from order book data (fresher than API)
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         * @param {number|null} ask - Top ask price (null if no asks)
         * @param {number|null} bid - Top bid price (null if no bids)
         */
        updatePrice(itemHrid, enhancementLevel, ask, bid) {
            const key = `${itemHrid}:${enhancementLevel}`;

            this.pricePatchs[key] = {
                a: ask,
                b: bid,
                timestamp: Date.now(),
            };

            // Save patches to storage (debounced via storage module)
            this.savePatches();

            // Notify listeners of price update
            this.notifyListeners();
        }

        /**
         * Load price patches from storage
         */
        async loadPatches() {
            try {
                // Check migration version - clear patches if old version
                const migrationVersion = await storage.get(this.CACHE_KEY_MIGRATION, 'settings', 0);

                if (migrationVersion < this.CURRENT_MIGRATION_VERSION) {
                    console.log(
                        `[MarketAPI] Migrating price patches from v${migrationVersion} to v${this.CURRENT_MIGRATION_VERSION}`
                    );
                    // Clear old patches (they may have corrupted data)
                    this.pricePatchs = {};
                    await storage.set(this.CACHE_KEY_PATCHES, {}, 'settings');
                    await storage.set(this.CACHE_KEY_MIGRATION, this.CURRENT_MIGRATION_VERSION, 'settings');
                    console.log('[MarketAPI] Price patches cleared due to migration');
                    return;
                }

                // Load patches normally
                const patches = await storage.getJSON(this.CACHE_KEY_PATCHES, 'settings', {});
                this.pricePatchs = patches || {};

                // Purge stale patches (older than API data)
                this.purgeStalePatches();
            } catch (error) {
                console.error('[MarketAPI] Failed to load price patches:', error);
                this.pricePatchs = {};
            }
        }

        /**
         * Remove patches older than the current API data
         * Called after loadPatches() to clean up stale patches
         */
        purgeStalePatches() {
            if (!this.lastFetchTimestamp) {
                return; // No API data loaded yet
            }

            let purgedCount = 0;
            const keysToDelete = [];

            for (const [key, patch] of Object.entries(this.pricePatchs)) {
                // Check for corrupted/invalid patches or stale timestamps
                if (!patch || !patch.timestamp || patch.timestamp < this.lastFetchTimestamp) {
                    keysToDelete.push(key);
                    purgedCount++;
                }
            }

            // Remove stale patches
            for (const key of keysToDelete) {
                delete this.pricePatchs[key];
            }

            if (purgedCount > 0) {
                console.log(`[MarketAPI] Purged ${purgedCount} stale price patches`);
                // Save cleaned patches
                this.savePatches();
            }
        }

        /**
         * Save price patches to storage
         */
        savePatches() {
            storage.setJSON(this.CACHE_KEY_PATCHES, this.pricePatchs, 'settings', true);
        }

        /**
         * Clear cache and fetch fresh market data
         * @returns {Promise<Object|null>} Fresh market data or null if failed
         */
        async clearCacheAndRefetch() {
            // Clear storage cache
            await storage.delete(this.CACHE_KEY_DATA, 'settings');
            await storage.delete(this.CACHE_KEY_TIMESTAMP, 'settings');

            // Clear in-memory state
            this.marketData = null;
            this.lastFetchTimestamp = null;

            // Force fresh fetch
            return await this.fetch(true);
        }

        /**
         * Register a listener for price updates
         * @param {Function} callback - Called when prices update
         */
        on(callback) {
            this.listeners.push(callback);
        }

        /**
         * Unregister a listener
         * @param {Function} callback - The callback to remove
         */
        off(callback) {
            this.listeners = this.listeners.filter((cb) => cb !== callback);
        }

        /**
         * Notify all listeners that prices have been updated
         */
        notifyListeners() {
            for (const callback of this.listeners) {
                try {
                    callback();
                } catch (error) {
                    console.error('[MarketAPI] Listener error:', error);
                }
            }
        }
    }

    const marketAPI = new MarketAPI();

    /**
     * Foundation Core Library
     * Core infrastructure and API clients only (no utilities)
     *
     * Exports to: window.Toolasha.Core
     */


    // Export to global namespace
    const toolashaRoot = window.Toolasha || {};
    window.Toolasha = toolashaRoot;

    if (typeof unsafeWindow !== 'undefined') {
        unsafeWindow.Toolasha = toolashaRoot;
    }

    toolashaRoot.Core = {
        storage,
        config,
        webSocketHook,
        domObserver,
        dataManager,
        featureRegistry: featureRegistry$1,
        settingsStorage,
        settingsGroups,
        tooltipObserver,
        profileManager: {
            setCurrentProfile,
            getCurrentProfile,
            clearCurrentProfile,
        },
        marketAPI,
    };

    console.log('[Toolasha] Core library loaded');

})();
