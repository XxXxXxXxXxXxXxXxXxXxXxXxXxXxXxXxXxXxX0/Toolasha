/**
 * Configuration Module
 * Manages all script constants and user settings
 */

import settingsStorage from './settings-storage.js';
import { settingsGroups } from './settings-schema.js';
import dataManager from './data-manager.js';

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
                description:
                    '在顶部栏实时追踪副本进度，包含波数时间、统计数据及组队频道完成消息',
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

export default config;
