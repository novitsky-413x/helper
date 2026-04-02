export type UiLang = "ru" | "en";

export type UiText = {
  model: string;
  memoryProfile: string;
  settings: string;
  uiLanguage: string;
  ttsVoice: string;
  ttsVoiceHint: string;
  thinkingInline: string;
  thinkingDetails: string;
  close: string;
  liveOff: string;
  liveOn: string;
  voiceOutputOn: string;
  voiceOutputOff: string;
  recordStart: string;
  recordStop: string;
  voiceLabel: string;
  listening: string;
  thinking: string;
  speaking: string;
  ready: string;
  messagePlaceholder: string;
  attachImage: string;
  removeImage: string;
  imageAttached: string;
  send: string;
  stop: string;
  newChat: string;
  regenerate: string;
  contextAnalytics: string;
  contextAnalyticsOpen: string;
  contextAnalyticsClose: string;
  estContextUsed: string;
  estContextLimit: string;
  estContextLeft: string;
  contextRisk: string;
  resolvedModel: string;
  selectedModel: string;
  modelUsageSession: string;
  lastRequestUsage: string;
  promptTokens: string;
  completionTokens: string;
  totalTokens: string;
  memoryInjected: string;
  memoryHits: string;
  mem0Usage: string;
  mem0Rows: string;
  mem0Chars: string;
  mem0ApproxTokens: string;
  mem0Note: string;
  analyticsProfileOwner: string;
  analyticsProfileStatus: string;
  analyticsProfileStatusLoading: string;
  analyticsProfileStatusEmpty: string;
  analyticsProfileStatusCurrent: string;
  analyticsProfileStatusStale: string;
  analyticsWarningHigh: string;
  analyticsWarningMedium: string;
  analyticsWarningLow: string;
  analyticsEstimateNote: string;
  estRequestCost: string;
  estRequestCostNote: string;
  sessionCost: string;
  modelCategories: string;
  noCategoryOptions: string;
  modelsLoading: string;
  categoryPrimary: string;
  categoryCodeMcp: string;
  categoryReasoning: string;
  categoryVision: string;
  categoryImageGen: string;
  categoryAudio: string;
  categoryMemory: string;
  memoryPolicyTitle: string;
  memoryPolicyHelp: string;
  memoryPolicyTopK: string;
  memoryPolicyTopKHelp: string;
  memoryPolicyMaxChars: string;
  memoryPolicyMaxCharsHelp: string;
  saveMemoryPolicy: string;
  memorySelectedProfileHint: string;
  memoryLoading: string;
  refresh: string;
  noMemoriesYet: string;
  addMcpServer: string;
  displayName: string;
  transportHttp: string;
  transportStdio: string;
  enabled: string;
  mcpUrl: string;
  command: string;
  args: string;
  saveServer: string;
  configured: string;
  testListTools: string;
  remove: string;
  noBrowserVoices: string;
  browserVoicesHint: string;
  profilesTitle: string;
  newProfileName: string;
  add: string;
  save: string;
  delete: string;
  update: string;
  profileDeleteConfirm: string;
  memoryDeleteConfirm: string;
  mcpDeleteConfirm: string;
  memoryTab: string;
  mcpTab: string;
  personaTitle: string;
  personaAvatar: string;
  personaVoiceStyle: string;
  personaVoiceStylePlaceholder: string;
  personaPersonality: string;
  personaPersonalityPlaceholder: string;
  savePersona: string;
  profileAddFailedTitle: string;
  profileAddFailedBody: string;
  genericRequestFailedTitle: string;
  genericRequestFailedBody: string;
  panelLoading: string;
  /** Bottom panel */
  bottomPanelBar: string;
  bottomTabTerminal: string;
  bottomTabTasks: string;
  bottomTabAgentLog: string;
  bottomClosePanel: string;
  bottomTasksEmpty: string;
  bottomAgentIdle: string;
  bottomAgentTurnLabel: string;
  /** Model picker */
  modelAutoOption: string;
  modelSearchPlaceholder: string;
  /** Composer slash menu */
  slashDescCompact: string;
  slashDescDream: string;
  slashDescPersona: string;
  slashDescTasks: string;
  slashDescLearn: string;
  slashDescWiki: string;
  slashDescAutopilot: string;
  slashDescContext: string;
  /** Sidebar */
  navChat: string;
  navLearning: string;
  navWiki: string;
  navAutopilot: string;
  navSettings: string;
  sidebarDreaming: string;
  sidebarDreamDone: string;
  sidebarReconnecting: string;
  sidebarConnected: string;
  sidebarDisconnected: string;
  /** Learning view */
  learningTitle: string;
  learningEmpty: string;
  learningLesson: string;
  /** Wiki view */
  wikiTitle: string;
  wikiSearchPlaceholder: string;
  wikiEmpty: string;
  wikiBack: string;
  /** Autopilot view */
  autopilotTitle: string;
  autopilotPassive: string;
  autopilotPassiveDesc: string;
  autopilotAdvisory: string;
  autopilotAdvisoryDesc: string;
  autopilotAutonomous: string;
  autopilotAutonomousDesc: string;
  autopilotRecentObs: string;
  autopilotObsEmpty: string;
  /** Settings route stub + agent toggle */
  settingsOpenButton: string;
  agentModeTooltipOn: string;
  agentModeTooltipOff: string;
  agentModeBadgeOn: string;
  agentModeBadgeOff: string;
  /** Voice status bar */
  voiceStt: string;
  voiceTts: string;
  toggleOnShort: string;
  toggleOffShort: string;
  /** Analytics (remaining English rows) */
  analyticsMemoryWrites: string;
  analyticsLastMemoryWrite: string;
  analyticsMem0InPrompt: string;
  analyticsOk: string;
  analyticsFail: string;
};

export const UI_TEXT: Record<UiLang, UiText> = {
  ru: {
    model: "Модель",
    memoryProfile: "Профиль памяти",
    settings: "Настройки",
    uiLanguage: "Язык интерфейса",
    ttsVoice: "Голос ассистента",
    ttsVoiceHint: "Качественные офлайн-голоса (RU, живее и естественнее)",
    thinkingInline: "Размышляет...",
    thinkingDetails: "Ход рассуждений",
    close: "Закрыть",
    liveOff: "Голосовой чат",
    liveOn: "Голосовой чат · вкл",
    voiceOutputOn: "Голос: вкл",
    voiceOutputOff: "Голос: выкл",
    recordStart: "Начать запись",
    recordStop: "Остановить запись",
    voiceLabel: "Голос",
    listening: "слушает",
    thinking: "думает...",
    speaking: "говорит...",
    ready: "Готово",
    messagePlaceholder: "Сообщение...",
    attachImage: "Фото",
    removeImage: "Убрать",
    imageAttached: "Изображение прикреплено",
    send: "Отправить",
    stop: "Стоп",
    newChat: "Новый чат",
    regenerate: "Перегенерировать",
    contextAnalytics: "Аналитика контекста",
    contextAnalyticsOpen: "Показать аналитику",
    contextAnalyticsClose: "Скрыть аналитику",
    estContextUsed: "Оценка занято",
    estContextLimit: "Лимит модели",
    estContextLeft: "Осталось до лимита",
    contextRisk: "Риск упереться в лимит",
    resolvedModel: "Фактическая модель",
    selectedModel: "Выбранная модель",
    modelUsageSession: "Модели в текущей сессии",
    lastRequestUsage: "Последний запрос (точно)",
    promptTokens: "Prompt tokens",
    completionTokens: "Completion tokens",
    totalTokens: "Total tokens",
    memoryInjected: "Инжектировано памяти (симв.)",
    memoryHits: "Попало записей mem0",
    mem0Usage: "Использование mem0 (профиль)",
    mem0Rows: "Записей",
    mem0Chars: "Символов",
    mem0ApproxTokens: "Оценка токенов",
    mem0Note:
      "mem0 хранится отдельно и почти не ограничен по объему, но в контекст попадает лишь небольшая выборка.",
    analyticsProfileOwner: "Владелец данных",
    analyticsProfileStatus: "Статус данных",
    analyticsProfileStatusLoading: "Загрузка...",
    analyticsProfileStatusEmpty: "Еще нет данных по запросам",
    analyticsProfileStatusCurrent: "Текущий профиль",
    analyticsProfileStatusStale: "Не совпадает с выбранным профилем",
    analyticsWarningHigh: "Высокий",
    analyticsWarningMedium: "Средний",
    analyticsWarningLow: "Низкий",
    analyticsEstimateNote: "Все значения по токенам оценочные.",
    estRequestCost: "Оценка стоимости запроса",
    estRequestCostNote: "Цена считается по тарифу модели за 1M токенов.",
    sessionCost: "Стоимость сессии (профиль)",
    modelCategories: "Категории моделей",
    noCategoryOptions: "Нет доступных моделей",
    modelsLoading: "Загрузка моделей...",
    categoryPrimary: "Быстрые первичные ответы",
    categoryCodeMcp: "Код и MCP",
    categoryReasoning: "Глубокие рассуждения",
    categoryVision: "Анализ изображений",
    categoryImageGen: "Генерация изображений",
    categoryAudio: "Аудио",
    categoryMemory: "Память (mem0)",
    memoryPolicyTitle: "Политика памяти",
    memoryPolicyHelp: "Эти настройки определяют, сколько долговременной памяти mem0 подмешивается в контекст.",
    memoryPolicyTopK: "Сколько записей брать (topK)",
    memoryPolicyTopKHelp: "Больше = точнее персонализация, но больше контекст и выше стоимость.",
    memoryPolicyMaxChars: "Лимит символов памяти",
    memoryPolicyMaxCharsHelp: "Жесткий потолок размера memory-блока, который попадает в промпт.",
    saveMemoryPolicy: "Сохранить политику памяти",
    memorySelectedProfileHint: "Записи памяти для выбранного профиля",
    memoryLoading: "Загрузка памяти...",
    refresh: "Обновить",
    noMemoriesYet: "Память пока пустая.",
    addMcpServer: "Добавить MCP сервер",
    displayName: "Имя",
    transportHttp: "HTTP (streamable)",
    transportStdio: "stdio",
    enabled: "включен",
    mcpUrl: "URL MCP",
    command: "Команда (например, npx)",
    args: "Аргументы (через пробел)",
    saveServer: "Сохранить сервер",
    configured: "Настроенные",
    testListTools: "Проверить / список инструментов",
    remove: "Удалить",
    noBrowserVoices: "Нет системных голосов",
    browserVoicesHint: "Используются системные голоса ОС/браузера.",
    profilesTitle: "Профили",
    newProfileName: "Имя нового профиля",
    add: "Добавить",
    save: "Сохранить",
    delete: "Удалить",
    update: "Обновить",
    profileDeleteConfirm: "Удалить профиль и его сохраненную память?",
    memoryDeleteConfirm: "Удалить эту запись памяти?",
    mcpDeleteConfirm: "Удалить этот MCP сервер?",
    memoryTab: "Память",
    mcpTab: "MCP",
    personaTitle: "🎭 Персона профиля",
    personaAvatar: "Аватар",
    personaVoiceStyle: "Стиль голоса",
    personaVoiceStylePlaceholder: "Дружелюбно, кратко...",
    personaPersonality: "Характер",
    personaPersonalityPlaceholder: "Как агент должен себя вести...",
    savePersona: "Сохранить персону",
    profileAddFailedTitle: "Не удалось создать профиль",
    profileAddFailedBody: "Проверьте ответ сервера и попробуйте снова.",
    genericRequestFailedTitle: "Запрос не выполнен",
    genericRequestFailedBody: "Проверьте соединение с сервером и попробуйте снова.",
    panelLoading: "Загрузка…",
    bottomPanelBar: "Панель",
    bottomTabTerminal: "Терминал",
    bottomTabTasks: "Задачи",
    bottomTabAgentLog: "Агент",
    bottomClosePanel: "Закрыть панель",
    bottomTasksEmpty: "Нет активных задач.",
    bottomAgentIdle: "Агент простаивает.",
    bottomAgentTurnLabel: "Ход",
    modelAutoOption: "Авто (по стоимости)",
    modelSearchPlaceholder: "Фильтр моделей…",
    slashDescCompact: "Сжать контекст диалога",
    slashDescDream: "Запустить консолидацию памяти",
    slashDescPersona: "Сменить персону агента",
    slashDescTasks: "Список задач агента",
    slashDescLearn: "Создать план обучения",
    slashDescWiki: "Поиск или статьи вики",
    slashDescAutopilot: "Статус автопилота / режим",
    slashDescContext: "Подсказка по контексту (см. аналитику)",
    navChat: "Чат",
    navLearning: "Обучение",
    navWiki: "Вики",
    navAutopilot: "Автопилот",
    navSettings: "Настройки",
    sidebarDreaming: "Сон памяти…",
    sidebarDreamDone: "Сон завершён",
    sidebarReconnecting: "Переподключение…",
    sidebarConnected: "Подключено",
    sidebarDisconnected: "Нет связи",
    learningTitle: "Планы обучения",
    learningEmpty:
      "Пока нет планов. В чате введите /learn <тема>, чтобы создать план.",
    learningLesson: "Урок",
    wikiTitle: "База знаний",
    wikiSearchPlaceholder: "Поиск по вики…",
    wikiEmpty: "Статей пока нет. Агент создаст их в процессе обучения.",
    wikiBack: "Назад",
    autopilotTitle: "Автопилот",
    autopilotPassive: "Пассивный",
    autopilotPassiveDesc: "Только журнал",
    autopilotAdvisory: "Советник",
    autopilotAdvisoryDesc: "Журнал и подсказки",
    autopilotAutonomous: "Автономный",
    autopilotAutonomousDesc: "Журнал и действия",
    autopilotRecentObs: "Недавние наблюдения",
    autopilotObsEmpty: "Пока нет наблюдений.",
    settingsOpenButton: "Открыть настройки",
    agentModeTooltipOn: "Режим агента: несколько шагов и инструменты",
    agentModeTooltipOff: "Обычный чат: один ответ без цикла агента",
    agentModeBadgeOn: "🤖 Агент",
    agentModeBadgeOff: "💬 Чат",
    voiceStt: "STT",
    voiceTts: "TTS",
    toggleOnShort: "вкл",
    toggleOffShort: "выкл",
    analyticsMemoryWrites: "Записей памяти (успех / ошибка)",
    analyticsLastMemoryWrite: "Последняя запись памяти",
    analyticsMem0InPrompt: "mem0 в текущем запросе",
    analyticsOk: "ок",
    analyticsFail: "ошибка",
  },
  en: {
    model: "Model",
    memoryProfile: "Memory profile",
    settings: "Settings",
    uiLanguage: "Interface language",
    ttsVoice: "Assistant voice",
    ttsVoiceHint: "High-quality offline voices (RU, more natural and lively)",
    thinkingInline: "Thinking...",
    thinkingDetails: "Reasoning",
    close: "Close",
    liveOff: "Voice chat",
    liveOn: "Voice chat · on",
    voiceOutputOn: "Voice output: on",
    voiceOutputOff: "Voice output: off",
    recordStart: "Start recording",
    recordStop: "Stop recording",
    voiceLabel: "Voice",
    listening: "listening",
    thinking: "thinking...",
    speaking: "speaking...",
    ready: "Ready",
    messagePlaceholder: "Message...",
    attachImage: "Image",
    removeImage: "Remove",
    imageAttached: "Image attached",
    send: "Send",
    stop: "Stop",
    newChat: "New chat",
    regenerate: "Regenerate",
    contextAnalytics: "Context analytics",
    contextAnalyticsOpen: "Show analytics",
    contextAnalyticsClose: "Hide analytics",
    estContextUsed: "Estimated used",
    estContextLimit: "Model limit",
    estContextLeft: "Remaining to limit",
    contextRisk: "Context overflow risk",
    resolvedModel: "Resolved model",
    selectedModel: "Selected model",
    modelUsageSession: "Models used in this session",
    lastRequestUsage: "Last request (exact)",
    promptTokens: "Prompt tokens",
    completionTokens: "Completion tokens",
    totalTokens: "Total tokens",
    memoryInjected: "Injected memory (chars)",
    memoryHits: "Injected mem0 entries",
    mem0Usage: "mem0 usage (profile)",
    mem0Rows: "Entries",
    mem0Chars: "Chars",
    mem0ApproxTokens: "Approx tokens",
    mem0Note:
      "mem0 is stored outside model context and is practically unbounded, but only a small subset is injected per request.",
    analyticsProfileOwner: "Data owner",
    analyticsProfileStatus: "Data status",
    analyticsProfileStatusLoading: "Loading...",
    analyticsProfileStatusEmpty: "No request data yet",
    analyticsProfileStatusCurrent: "Current profile",
    analyticsProfileStatusStale: "Does not match selected profile",
    analyticsWarningHigh: "High",
    analyticsWarningMedium: "Medium",
    analyticsWarningLow: "Low",
    analyticsEstimateNote: "Token metrics are approximate.",
    estRequestCost: "Estimated request cost",
    estRequestCostNote: "Calculated from model pricing per 1M tokens.",
    sessionCost: "Session cost (profile)",
    modelCategories: "Model categories",
    noCategoryOptions: "No available models",
    modelsLoading: "Loading models...",
    categoryPrimary: "Fast primary responses",
    categoryCodeMcp: "Code and MCP",
    categoryReasoning: "Deep reasoning",
    categoryVision: "Image analysis",
    categoryImageGen: "Image generation",
    categoryAudio: "Audio",
    categoryMemory: "Memory (mem0)",
    memoryPolicyTitle: "Memory policy",
    memoryPolicyHelp: "These settings control how much long-term mem0 memory is injected into context.",
    memoryPolicyTopK: "How many entries to retrieve (topK)",
    memoryPolicyTopKHelp: "Higher values improve personalization but increase context and cost.",
    memoryPolicyMaxChars: "Memory chars limit",
    memoryPolicyMaxCharsHelp: "Hard cap for memory block size injected into prompt.",
    saveMemoryPolicy: "Save memory policy",
    memorySelectedProfileHint: "Memory rows for the selected profile",
    memoryLoading: "Loading memories...",
    refresh: "Refresh",
    noMemoriesYet: "No memories yet.",
    addMcpServer: "Add MCP server",
    displayName: "Display name",
    transportHttp: "HTTP (streamable)",
    transportStdio: "stdio",
    enabled: "enabled",
    mcpUrl: "MCP URL",
    command: "Command (e.g. npx)",
    args: "Args (space-separated)",
    saveServer: "Save server",
    configured: "Configured",
    testListTools: "Test / list tools",
    remove: "Remove",
    noBrowserVoices: "No browser voices",
    browserVoicesHint: "Uses your OS/Chrome voices for natural speech.",
    profilesTitle: "Profiles",
    newProfileName: "New profile name",
    add: "Add",
    save: "Save",
    delete: "Delete",
    update: "Update",
    profileDeleteConfirm: "Delete this profile and its stored memories?",
    memoryDeleteConfirm: "Delete this memory?",
    mcpDeleteConfirm: "Remove this MCP server?",
    memoryTab: "Memory",
    mcpTab: "MCP",
    personaTitle: "🎭 Profile persona",
    personaAvatar: "Avatar",
    personaVoiceStyle: "Voice style",
    personaVoiceStylePlaceholder: "Friendly, concise...",
    personaPersonality: "Personality",
    personaPersonalityPlaceholder: "Describe how the agent should behave...",
    savePersona: "Save persona",
    profileAddFailedTitle: "Could not create profile",
    profileAddFailedBody: "Check the server response and try again.",
    genericRequestFailedTitle: "Request failed",
    genericRequestFailedBody: "Check your connection to the server and try again.",
    panelLoading: "Loading…",
    bottomPanelBar: "Panel",
    bottomTabTerminal: "Terminal",
    bottomTabTasks: "Tasks",
    bottomTabAgentLog: "Agent",
    bottomClosePanel: "Close panel",
    bottomTasksEmpty: "No active tasks.",
    bottomAgentIdle: "Agent idle.",
    bottomAgentTurnLabel: "Turn",
    modelAutoOption: "Auto (cost-aware)",
    modelSearchPlaceholder: "Filter models…",
    slashDescCompact: "Compact conversation context",
    slashDescDream: "Trigger memory consolidation",
    slashDescPersona: "Switch agent persona",
    slashDescTasks: "List current agent tasks",
    slashDescLearn: "Create a learning plan",
    slashDescWiki: "Search or create wiki articles",
    slashDescAutopilot: "Autopilot status / toggle mode",
    slashDescContext: "Context hint (see analytics)",
    navChat: "Chat",
    navLearning: "Learning",
    navWiki: "Wiki",
    navAutopilot: "Autopilot",
    navSettings: "Settings",
    sidebarDreaming: "Dreaming…",
    sidebarDreamDone: "Dream done",
    sidebarReconnecting: "Reconnecting…",
    sidebarConnected: "Connected",
    sidebarDisconnected: "Disconnected",
    learningTitle: "Learning Plans",
    learningEmpty: "No learning plans yet. Use /learn <topic> in chat to create one.",
    learningLesson: "Lesson",
    wikiTitle: "Knowledge Base",
    wikiSearchPlaceholder: "Search wiki…",
    wikiEmpty: "No wiki articles yet. The agent will create them during learning sessions.",
    wikiBack: "Back",
    autopilotTitle: "Autopilot Observer",
    autopilotPassive: "Passive",
    autopilotPassiveDesc: "Log only",
    autopilotAdvisory: "Advisory",
    autopilotAdvisoryDesc: "Log + suggest",
    autopilotAutonomous: "Autonomous",
    autopilotAutonomousDesc: "Log + act",
    autopilotRecentObs: "Recent Observations",
    autopilotObsEmpty: "No observations yet.",
    settingsOpenButton: "Open settings",
    agentModeTooltipOn: "Agent mode: multi-step runs with tools",
    agentModeTooltipOff: "Standard chat: single reply without agent loop",
    agentModeBadgeOn: "🤖 Agent",
    agentModeBadgeOff: "💬 Chat",
    voiceStt: "STT",
    voiceTts: "TTS",
    toggleOnShort: "on",
    toggleOffShort: "off",
    analyticsMemoryWrites: "Memory writes (ok / fail)",
    analyticsLastMemoryWrite: "Last memory write",
    analyticsMem0InPrompt: "mem0 in current prompt",
    analyticsOk: "ok",
    analyticsFail: "fail",
  },
};
