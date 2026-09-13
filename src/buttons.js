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
        this.pendingActionIds = new Set();
        this.cooldowns = new Set();
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
        this.leftButtons = this.normalizeButtons('left');
        this.rightButtons = this.normalizeButtons('right');
        for (const button of [...this.leftButtons, ...this.rightButtons]) {
            button.dependencies = [
                ...new Set([button.entity, ...this.buttonPlayers(button)]),
            ].filter(Boolean);
        }
    }

    dispose() {
        for (const timer of this.cooldowns) clearTimeout(timer);
        this.cooldowns.clear();
        this.pendingActionIds.clear();
    }

    normalizeButtons(position) {
        if (Array.isArray(this.config.buttons)) {
            return this.config.buttons
                .filter((button) => (button.position || 'left') === position)
                .map((button, index) => this.normalizeButton(button, `${position}-${index}`));
        }

        return [];
    }

    normalizeButton(value, fallbackId) {
        const button = typeof value === 'string' ? { entity: value } : { ...(value || {}) };
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
        const title = merged.title || this.defaultButtonTitle(merged) || '';
        const tapAction = this.normalizeLovelaceAction(
            button.tap_action || defaults.tap_action || button,
        );

        return {
            id: fallbackId,
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
        const player =
            button.player || this.config.player || this.defaultPlayerEntity(button.entity);
        if (!player) return this.appearanceDefaults(button.appearance || 'alert');

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
        const player =
            button.player || this.config.player || this.defaultPlayerEntity(button.entity);
        const message = button.tts || button.message;
        const ttsEntity = button.tts_entity || this.config.tts_entity || DEFAULT_TTS_ENTITY;
        if (!player || !message || !ttsEntity)
            return this.appearanceDefaults(button.appearance || 'alert');

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
                unavailable: {
                    ...this.appearanceDefaults('disabled'),
                    title: `${title} unavailable`,
                    icon: 'mdi:lightbulb-alert',
                    disabled: true,
                },
                unknown: {
                    ...this.appearanceDefaults('disabled'),
                    title: `${title} unknown`,
                    icon: 'mdi:lightbulb-alert',
                    disabled: true,
                },
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
                unavailable: {
                    ...this.appearanceDefaults('disabled'),
                    title: `${title} unavailable`,
                    icon: 'mdi:alert-circle-outline',
                    disabled: true,
                },
                unknown: {
                    ...this.appearanceDefaults('disabled'),
                    title: `${title} unknown`,
                    icon: 'mdi:alert-circle-outline',
                    disabled: true,
                },
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

    defaultPlayerEntity(entityId) {
        if (this.entityDomain(entityId) === 'media_player') return entityId;

        const stream = this.config.stream;
        if (typeof stream !== 'string' || !/^[a-z0-9_]+$/i.test(stream)) return undefined;
        return `media_player.${stream.toLowerCase()}`;
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

    createActionButton(buttonConfig) {
        const button = document.createElement('button');
        this.elements.set(buttonConfig.id, button);
        button.type = 'button';
        button.dataset.buttonId = buttonConfig.id;
        button.title = buttonConfig.title;
        button.setAttribute('aria-label', buttonConfig.title || buttonConfig.id);

        const icon = document.createElement('ha-icon');
        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('icon', buttonConfig.icon);
        button.appendChild(icon);

        this.applyStateToButton(button, buttonConfig);
        this.bindActionButton(button, buttonConfig);
        return button;
    }

    bindActionButton(button, buttonConfig) {
        button.addEventListener('click', (ev) => {
            ev.preventDefault();
            if (button.disabled) return;
            this.dispatchButtonAction(button, buttonConfig);
        });
    }

    updateStatefulButtons(previousHass) {
        if (!this.card.shadowRoot) return;

        [...this.leftButtons, ...this.rightButtons].forEach((buttonConfig) => {
            if (
                previousHass &&
                buttonConfig.dependencies.every(
                    (id) => previousHass.states?.[id] === this.hass?.states?.[id],
                )
            )
                return;
            const button = this.elements.get(buttonConfig.id);
            if (button) this.applyStateToButton(button, buttonConfig);
        });
    }

    applyStateToButton(button, config) {
        const state = this.entityStateForButton(config);
        const stateConfig = this.effectiveStateConfigForButton(config, state);
        const visual = this.buttonVisualConfig(config, stateConfig);

        const icon = button.querySelector('ha-icon');
        if (visual.icon && icon) icon.setAttribute('icon', visual.icon);
        button.title = visual.title || config.id;
        button.setAttribute('aria-label', visual.title || config.id);
        this.setOptionalVar(button, '--button-color', visual.color);
        this.setOptionalVar(button, '--button-background', visual.background);
        this.setOptionalVar(button, '--button-hover-background', visual.hover_background);
        this.setOptionalVar(button, '--button-border', visual.border);

        if (state) {
            button.dataset.entityState = state;
        } else {
            delete button.dataset.entityState;
        }
        button.hidden = this.buttonHidden(stateConfig);
        this.syncButtonDisabled(button, config, state, stateConfig);
    }

    buttonVisualConfig(config, stateConfig = {}) {
        return {
            title: stateConfig.title ?? config.title,
            icon: stateConfig.icon ?? config.icon,
            color: stateConfig.color ?? config.color,
            background: stateConfig.background ?? config.background,
            hover_background: stateConfig.hover_background ?? config.hover_background,
            border: stateConfig.border ?? config.border,
        };
    }

    entityStateForButton(config) {
        if (!config.entity) return undefined;
        if (!this.hass?.states) return 'unavailable';
        return this.hass.states[config.entity]?.state || 'unavailable';
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
        if (!config.states) return {};
        return config.states[state] || config.states.default || {};
    }

    effectiveStateConfigForButton(config, state = this.entityStateForButton(config)) {
        const stateConfig = this.stateConfigForButton(config, state);
        return {
            disabled: config.disabled,
            hidden: config.hidden,
            ...stateConfig,
            ...this.audioPlayerAvailabilityConfig(config, stateConfig),
        };
    }

    audioPlayerAvailabilityConfig(config, stateConfig = {}) {
        const action = stateConfig.tap_action || config.tap_action;
        if (!config.audio && !this.isAudioAction(action)) return {};

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

        if (!this.hass?.states) {
            return this.unavailableButtonConfig(
                config,
                'unavailable',
                `${config.title || 'Audio'} unavailable`,
                'mdi:speaker-off',
            );
        }

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

    buttonHidden(stateConfig) {
        return Boolean(stateConfig.hidden);
    }

    syncButtonDisabled(button, config, state = this.entityStateForButton(config), stateConfig) {
        const currentStateConfig = stateConfig || this.effectiveStateConfigForButton(config, state);
        const stateDisabled = Boolean(currentStateConfig.disabled);
        const actionConfig = currentStateConfig.tap_action || config.tap_action;
        const audioDisabled = this.talking && (config.audio || this.isAudioAction(actionConfig));
        const actionDisabled = !actionConfig || actionConfig.action === 'none';

        button.disabled =
            this.pendingActionIds.has(config.id) ||
            stateDisabled ||
            audioDisabled ||
            actionDisabled;
        button.classList.toggle('state-disabled', stateDisabled);
        button.classList.toggle('audio-disabled', audioDisabled);
        button.classList.toggle('action-disabled', actionDisabled);
        if (audioDisabled) {
            button.title = 'Hang up before playing audio';
            button.setAttribute('aria-label', button.title);
        }
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

    dispatchButtonAction(button, buttonConfig) {
        if (!button.isConnected || !this.card.shadowRoot?.contains(button)) return;
        if (this.pendingActionIds.has(buttonConfig.id)) return;

        const state = this.entityStateForButton(buttonConfig);
        const stateConfig = this.effectiveStateConfigForButton(buttonConfig, state);
        if (this.buttonHidden(stateConfig)) return;
        if (stateConfig.disabled) return;

        const actionConfig = stateConfig.tap_action || buttonConfig.tap_action;
        if (!actionConfig || actionConfig.action === 'none') return;
        if (this.talking && (buttonConfig.audio || this.isAudioAction(actionConfig))) return;

        this.pendingActionIds.add(buttonConfig.id);
        button.disabled = true;
        const timer = setTimeout(() => {
            this.cooldowns.delete(timer);
            this.pendingActionIds.delete(buttonConfig.id);
            this.updateStatefulButtons();
        }, buttonConfig.cooldown);
        this.cooldowns.add(timer);

        if (actionConfig.action === 'fire-dom-event') {
            this.fireDomEvent(actionConfig, buttonConfig);
        } else {
            this.fireHassAction(buttonConfig, stateConfig);
        }

        const successStatus = stateConfig.success_status ?? buttonConfig.success_status;
        if (successStatus) {
            this.card.showStatus(successStatus, 1200);
        }
    }

    fireHassAction(buttonConfig, stateConfig) {
        const event = new CustomEvent('hass-action', {
            bubbles: true,
            composed: true,
            detail: {
                action: 'tap',
                config: this.actionHandlerConfig(buttonConfig, stateConfig),
            },
        });
        this.card.dispatchEvent(event);
    }

    actionHandlerConfig(buttonConfig, stateConfig = {}) {
        return {
            entity: buttonConfig.entity,
            tap_action: stateConfig.tap_action || buttonConfig.tap_action,
        };
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
