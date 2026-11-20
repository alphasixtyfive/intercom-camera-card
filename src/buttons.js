import {
    BUTTON_COOLDOWN_MS,
    DEFAULT_TTS_ENTITY,
    UNAVAILABLE_ENTITY_STATES,
    SOUND_BASE_PATH,
    BUTTON_STYLE_PRESETS,
} from './defaults.js';

export class IntercomButtons {
    constructor(card) {
        this.card = card;
        this.leftButtons = [];
        this.rightButtons = [];
        this.cooldowns = new Map();
        this.elements = new Map();
    }

    get config() {
        return this.card.config;
    }
    get hass() {
        return this.card.hass;
    }
    get talking() {
        return this.card.talking;
    }

    configure() {
        this.dispose();
        this.leftButtons = [];
        this.rightButtons = [];
        for (const config of this.config.buttons) {
            const position = config.position || 'left';
            const group = position === 'right' ? this.rightButtons : this.leftButtons;
            const button = this.normalizeButton(config, `${position}-${group.length}`);
            button.dependencies = [
                ...new Set([button.entity, ...this.buttonPlayers(button)]),
            ].filter(Boolean);
            group.push(button);
        }
    }

    dispose() {
        for (const timer of this.cooldowns.values()) clearTimeout(timer);
        this.cooldowns.clear();
    }

    normalizeButton(button, id) {
        const defaults = this.buttonDefaults(button);
        const merged = {
            ...defaults,
            ...button,
            states: Object.assign(Object.create(null), defaults.states),
        };
        for (const [state, override] of Object.entries(button.states ?? {})) {
            merged.states[state] = { ...merged.states[state], ...override };
            if (override.tap_action) {
                merged.states[state].tap_action = this.normalizeLovelaceAction(override.tap_action);
            }
        }
        let fallbackTitle = 'Run action';
        if (button.sound) fallbackTitle = 'Play sound';
        else if (button.tts || button.message) fallbackTitle = 'Play message';
        const title = merged.title || this.defaultButtonTitle(merged) || fallbackTitle;
        const tapAction = this.normalizeLovelaceAction(
            button.tap_action || defaults.tap_action || button,
        );

        return {
            id,
            entity: button.entity || defaults.entity,
            title,
            icon: merged.icon || 'mdi:circle',
            color: merged.color || '#f3f7ff',
            background: merged.background,
            hover_background: merged.hover_background,
            border: merged.border,
            audio: Boolean(merged.audio ?? this.isAudioAction(tapAction)),
            disabled: merged.disabled ?? false,
            hidden: merged.hidden ?? false,
            player: merged.player || this.playerFromAction(tapAction),
            states: merged.states || {},
            success_status: merged.success_status,
            cooldown: merged.cooldown ?? BUTTON_COOLDOWN_MS,
            tap_action: tapAction,
        };
    }

    buttonDefaults(button) {
        if (button.sound) return this.soundButtonDefaults(button);
        if (button.tts || button.message) return this.ttsButtonDefaults(button);

        const domain = this.entityDomain(button.entity);
        if (domain === 'light') return this.lightButtonDefaults(button);
        if (domain === 'cover') return this.coverButtonDefaults(button);

        return this.appearanceDefaults(button.appearance);
    }

    soundButtonDefaults(button) {
        const player = button.player || this.config.player;
        if (!player) {
            return {
                ...this.appearanceDefaults(button.appearance || 'alert'),
                audio: true,
                icon: button.icon || 'mdi:bullhorn',
            };
        }

        return {
            ...this.appearanceDefaults(button.appearance || 'alert'),
            audio: true,
            player,
            icon: button.icon || 'mdi:bullhorn',
            tap_action: {
                action: 'perform-action',
                perform_action: 'media_player.play_media',
                target: { entity_id: player },
                data: {
                    media_content_type: 'music',
                    media_content_id: this.resolveMediaPath(button.sound),
                },
            },
        };
    }

    ttsButtonDefaults(button) {
        const player = button.player || this.config.player;
        const message = button.tts || button.message;
        const ttsEntity = button.tts_entity || this.config.tts_entity || DEFAULT_TTS_ENTITY;
        if (!player || !message || !ttsEntity) {
            return {
                ...this.appearanceDefaults(button.appearance || 'alert'),
                audio: true,
                icon: button.icon || 'mdi:message-alert',
            };
        }

        return {
            ...this.appearanceDefaults(button.appearance || 'alert'),
            audio: true,
            player,
            icon: button.icon || 'mdi:message-alert',
            success_status: button.success_status || 'Playing message',
            tap_action: {
                action: 'perform-action',
                perform_action: 'tts.speak',
                target: { entity_id: ttsEntity },
                data: {
                    media_player_entity_id: player,
                    message,
                    cache: button.cache ?? true,
                },
            },
        };
    }

    lightButtonDefaults(button) {
        const title = button.title || this.defaultButtonTitle(button) || 'Light';

        return {
            ...this.appearanceDefaults('light'),
            icon: button.icon || 'mdi:lightbulb-off-outline',
            tap_action: this.performActionConfig('light.toggle', button.entity),
            states: {
                on: {
                    ...this.appearanceDefaults('light_on'),
                    title: `${title} on`,
                    icon: 'mdi:lightbulb-on',
                },
                off: {
                    ...this.appearanceDefaults('light'),
                    title: `${title} off`,
                    icon: button.icon || 'mdi:lightbulb-off-outline',
                },
                unavailable: this.unavailableButtonConfig(
                    { title },
                    'unavailable',
                    undefined,
                    'mdi:lightbulb-alert',
                ),
                unknown: this.unavailableButtonConfig(
                    { title },
                    'unknown',
                    undefined,
                    'mdi:lightbulb-alert',
                ),
            },
        };
    }

    coverButtonDefaults(button) {
        const title = button.title || this.defaultButtonTitle(button) || 'Cover';
        const closedIcon = button.icon || this.defaultCoverIcon(button, false);
        const openIcon = this.defaultCoverIcon(button, true);
        const appearance = button.appearance || 'primary';

        return {
            ...this.appearanceDefaults(appearance),
            icon: closedIcon,
            states: {
                closed: {
                    ...this.appearanceDefaults(appearance),
                    title: `Open ${title}`,
                    icon: closedIcon,
                    success_status: `Opening ${title}`,
                    tap_action: this.performActionConfig('cover.open_cover', button.entity),
                },
                open: {
                    ...this.appearanceDefaults(appearance),
                    title: `Close ${title}`,
                    icon: openIcon,
                    success_status: `Closing ${title}`,
                    tap_action: this.performActionConfig('cover.close_cover', button.entity),
                },
                opening: {
                    ...this.appearanceDefaults('warning'),
                    title: `${title} opening`,
                    icon: openIcon,
                    disabled: true,
                },
                closing: {
                    ...this.appearanceDefaults('warning'),
                    title: `${title} closing`,
                    icon: closedIcon,
                    disabled: true,
                },
                unavailable: this.unavailableButtonConfig({ title }),
                unknown: this.unavailableButtonConfig({ title }, 'unknown'),
            },
        };
    }

    appearanceDefaults(appearance) {
        return { ...(BUTTON_STYLE_PRESETS[appearance] || {}) };
    }

    performActionConfig(actionName, entityId) {
        if (!entityId) return undefined;

        return {
            action: 'perform-action',
            perform_action: actionName,
            target: { entity_id: entityId },
        };
    }

    resolveMediaPath(path) {
        if (!path) return path;
        if (path.startsWith('/') || path.includes('://')) return path;
        return SOUND_BASE_PATH + path;
    }

    defaultCoverIcon(button, open) {
        const label = `${button.title || ''} ${button.entity || ''}`.toLowerCase();
        if (label.includes('gate')) return open ? 'mdi:gate-open' : 'mdi:gate';
        return open ? 'mdi:garage-open' : 'mdi:garage';
    }

    entityDomain(entityId) {
        return typeof entityId === 'string' ? entityId.split('.', 1)[0] : undefined;
    }

    defaultButtonTitle(button) {
        const entityId = button.entity || '';
        const objectId = entityId.includes('.') ? entityId.split('.')[1] : '';
        if (!objectId) return '';
        return objectId.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    }

    normalizeLovelaceAction(action) {
        if (!action) return undefined;

        if (action.tap_action) return this.normalizeLovelaceAction(action.tap_action);
        if (action.action) return { ...action };
        if (action.perform_action) return { action: 'perform-action', ...action };
        if (action.entity) {
            return {
                action: 'more-info',
                entity: action.entity,
            };
        }

        return { action: 'none' };
    }

    isAudioAction(action) {
        const actionName = action?.perform_action || action?.service;
        return actionName === 'media_player.play_media' || actionName === 'tts.speak';
    }

    playerFromAction(action) {
        if (!this.isAudioAction(action)) return undefined;

        const actionName = action?.perform_action || action?.service;
        const data = action.data || action.service_data;
        const entityId =
            actionName === 'tts.speak'
                ? data?.media_player_entity_id
                : action?.target?.entity_id || data?.entity_id || action?.entity;
        const players = this.asArray(entityId).filter(
            (entity) => this.entityDomain(entity) === 'media_player',
        );
        if (!players.length) return undefined;
        return players.length === 1 ? players[0] : players;
    }

    asArray(value) {
        if (Array.isArray(value)) return value;
        return value ? [value] : [];
    }

    renderActionButtons() {
        this.elements.clear();
        this.renderButtonGroup('.left-buttons', this.leftButtons);
        this.renderButtonGroup('.right-buttons', this.rightButtons);
    }

    renderButtonGroup(selector, buttons) {
        const group = this.card.$(selector);
        group.replaceChildren(
            ...buttons.map((buttonConfig) => this.createActionButton(buttonConfig)),
        );
    }

    createActionButton(config) {
        const button = document.createElement('button');
        this.elements.set(config.id, { button, config });
        button.type = 'button';
        button.dataset.buttonId = config.id;

        const icon = document.createElement('ha-icon');
        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('icon', config.icon);
        button.appendChild(icon);
        this.applyStateToButton(button, config);
        button.addEventListener('click', (event) => {
            event.preventDefault();
            if (!button.disabled) this.dispatchButtonAction(button, config);
        });
        return button;
    }

    updateStatefulButtons(previousHass) {
        const previous = previousHass?.states;
        const current = this.hass?.states;
        for (const { button, config } of this.elements.values()) {
            if (
                previousHass &&
                config.dependencies.every((id) => previous?.[id] === current?.[id])
            ) {
                continue;
            }
            this.applyStateToButton(button, config);
        }
    }

    applyStateToButton(button, config) {
        const { overrides, hidden, disabled, audioLocked } = this.resolveButton(config);
        const icon = button.firstElementChild;
        const iconName = overrides.icon ?? config.icon;
        if (iconName && icon.getAttribute('icon') !== iconName) icon.setAttribute('icon', iconName);
        const title = audioLocked
            ? 'Hang up before playing audio'
            : (overrides.title ?? config.title);
        button.title = title || config.id;
        button.setAttribute('aria-label', button.title);
        this.setOptionalVar(button, '--button-color', overrides.color ?? config.color);
        this.setOptionalVar(
            button,
            '--button-background',
            overrides.background ?? config.background,
        );
        this.setOptionalVar(
            button,
            '--button-hover-background',
            overrides.hover_background ?? config.hover_background,
        );
        this.setOptionalVar(button, '--button-border', overrides.border ?? config.border);
        button.hidden = hidden;
        button.disabled = disabled;
    }

    stateConfigForButton(config, state) {
        if (!state) return {};
        if (this.isUnavailableState(state)) {
            return (
                config.states?.[state] ||
                config.states?.unavailable ||
                this.unavailableButtonConfig(config, state)
            );
        }
        return config.states[state] || config.states.default || {};
    }

    resolveButton(config) {
        const state = config.entity
            ? this.hass?.states?.[config.entity]?.state || 'unavailable'
            : undefined;
        const stateConfig = this.stateConfigForButton(config, state);
        const action = stateConfig.tap_action || config.tap_action;
        const audio = config.audio || this.isAudioAction(action);
        const overrides = audio
            ? { ...stateConfig, ...this.audioPlayerAvailabilityConfig(config, action) }
            : stateConfig;
        const audioLocked = this.talking && audio;
        return {
            overrides,
            action,
            audioLocked,
            hidden: overrides.hidden ?? config.hidden,
            disabled:
                (overrides.disabled ?? config.disabled) ||
                this.cooldowns.has(config.id) ||
                audioLocked ||
                !action ||
                action.action === 'none',
        };
    }

    audioPlayerAvailabilityConfig(config, action) {
        const target = this.playerFromAction(action) || config.player;
        const players = this.asArray(target).filter(
            (player) => this.entityDomain(player) === 'media_player',
        );
        if (!players.length)
            return this.unavailableButtonConfig(
                config,
                'unavailable',
                'Audio target unavailable',
                'mdi:speaker-off',
            );

        const unavailablePlayer = players.find((player) => !this.entityAvailable(player));
        if (!unavailablePlayer) return {};

        const title = `${config.title || this.defaultButtonTitle({ entity: unavailablePlayer }) || 'Audio'} unavailable`;
        return this.unavailableButtonConfig(config, 'unavailable', title, 'mdi:speaker-off');
    }

    unavailableButtonConfig(
        config,
        state = 'unavailable',
        title,
        icon = 'mdi:alert-circle-outline',
    ) {
        const label = config.title || this.defaultButtonTitle(config) || 'Button';
        return {
            ...this.appearanceDefaults('disabled'),
            title: title || `${label} ${state}`,
            icon,
            disabled: true,
        };
    }

    isUnavailableState(state) {
        return UNAVAILABLE_ENTITY_STATES.has(state);
    }

    entityAvailable(entityId) {
        const state = this.hass?.states?.[entityId]?.state;
        return Boolean(state) && !this.isUnavailableState(state);
    }

    setOptionalVar(element, name, value) {
        if (value !== undefined && value !== null) {
            element.style.setProperty(name, value);
        } else {
            element.style.removeProperty(name);
        }
    }

    buttonPlayers(button) {
        const actions = [
            button.tap_action,
            ...Object.values(button.states).map((state) => state.tap_action),
        ];
        return [
            ...new Set([
                ...this.asArray(button.player),
                ...actions.flatMap((action) => this.asArray(this.playerFromAction(action))),
            ]),
        ];
    }

    audioPlayers() {
        const players = [
            this.config?.player,
            ...[...this.leftButtons, ...this.rightButtons].flatMap((button) =>
                this.buttonPlayers(button),
            ),
        ].flatMap((value) => this.asArray(value));

        return [
            ...new Set(
                players.filter(
                    (player) =>
                        this.entityDomain(player) === 'media_player' &&
                        this.entityAvailable(player),
                ),
            ),
        ];
    }

    dispatchButtonAction(button, config) {
        if (!button.isConnected || this.elements.get(config.id)?.button !== button) return;
        const { overrides, action, hidden, disabled } = this.resolveButton(config);
        if (hidden || disabled) return;

        button.disabled = true;
        const timer = setTimeout(() => {
            this.cooldowns.delete(config.id);
            this.applyStateToButton(button, config);
        }, config.cooldown);
        this.cooldowns.set(config.id, timer);

        if (action.action === 'fire-dom-event') {
            this.fireDomEvent(action, config);
        } else {
            this.card.dispatchEvent(
                new CustomEvent('hass-action', {
                    bubbles: true,
                    composed: true,
                    detail: {
                        action: 'tap',
                        config: { entity: config.entity, tap_action: action },
                    },
                }),
            );
        }

        const status = overrides.success_status ?? config.success_status;
        if (status) this.card.showStatus(status, 1200);
    }

    fireDomEvent(actionConfig, buttonConfig) {
        const type = actionConfig.event_type || 'intercom-camera-card-action';
        const { event_data: eventData, ...actionDetail } = actionConfig;
        this.card.dispatchEvent(
            new CustomEvent(type, {
                bubbles: true,
                composed: true,
                detail: {
                    ...actionDetail,
                    ...(eventData || {}),
                    config: this.config,
                    button: buttonConfig,
                },
            }),
        );
    }
}
