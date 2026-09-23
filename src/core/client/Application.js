const { Client, GatewayIntentBits, Partials, ActivityType } = require("discord.js");

const ConfigService = require("../config/ConfigService");
const GuildConfigService = require("../config/GuildConfigService");
const DatabaseService = require("../database/Database");
const GuildRepository = require("../database/repositories/GuildRepository");
const CaseRepository = require("../database/repositories/CaseRepository");
const StaffRepository = require("../database/repositories/StaffRepository");
const ErrorRepository = require("../database/repositories/ErrorRepository");
const TicketRepository = require("../database/repositories/TicketRepository");
const ActivityRepository = require("../database/repositories/ActivityRepository");
const GiveawayRepository = require("../database/repositories/GiveawayRepository");
const PollRepository = require("../database/repositories/PollRepository");
const ElectionRepository = require("../database/repositories/ElectionRepository");
const SocialRepository = require("../database/repositories/SocialRepository");
const MilitaryRepository = require("../database/repositories/MilitaryRepository");
const IdentityRepository = require("../database/repositories/IdentityRepository");
const GovernmentRepository = require("../database/repositories/GovernmentRepository");
const RpRepository = require("../database/repositories/RpRepository");
const QuestRepository = require("../database/repositories/QuestRepository");
const SelfRoleRepository = require("../database/repositories/SelfRoleRepository");
const EmbedRepository = require("../database/repositories/EmbedRepository");
const CustomCommandRepository = require("../database/repositories/CustomCommandRepository");
const EconomyRepository = require("../database/repositories/EconomyRepository");
const ViolationRepository = require("../database/repositories/ViolationRepository");
const FlightRepository = require("../database/repositories/FlightRepository");
const TicketTypeRepository = require("../database/repositories/TicketTypeRepository");
const ApplicationRepository = require("../database/repositories/ApplicationRepository");
const QuizRepository = require("../database/repositories/QuizRepository");
const LifecycleRepository = require("../database/repositories/LifecycleRepository");
const AutoReplyRepository = require("../database/repositories/AutoReplyRepository");
const StarboardRepository = require("../database/repositories/StarboardRepository");
const InvoiceRepository = require("../database/repositories/InvoiceRepository");
const OversightRepository = require("../database/repositories/OversightRepository");
const ReportRepository = require("../database/repositories/ReportRepository");
const ReactionReplyRepository = require("../database/repositories/ReactionReplyRepository");
const FeaturedRepository = require("../database/repositories/FeaturedRepository");
const ChangelogRepository = require("../database/repositories/ChangelogRepository");
const GithubWebhookRepository = require("../database/repositories/GithubWebhookRepository");

const Logger = require("../logger/Logger");
const LogService = require("../logger/LogService");
const I18n = require("../i18n/I18n");
const { EventBus } = require("../events/EventBus");
const { PermissionService } = require("../permissions/PermissionService");
const ErrorHandler = require("../errors/ErrorHandler");
const CommandRegistry = require("../commands/CommandRegistry");
const CommandHandler = require("../commands/CommandHandler");
const InteractionRouter = require("../interactions/InteractionRouter");

const ModerationService = require("../../modules/moderation/ModerationService");
const TicketService = require("../../modules/tickets/TicketService");
const TicketAutomation = require("../../modules/tickets/TicketAutomation");
const StaffService = require("../../modules/staff/StaffService");
const SecurityService = require("../../modules/security/SecurityService");
const GiveawayService = require("../../modules/giveaways/GiveawayService");
const PollService = require("../../modules/polls/PollService");
const ElectionService = require("../../modules/elections/ElectionService");
const SocialService = require("../../modules/social/SocialService");
const MilitaryService = require("../../modules/military/MilitaryService");
const IdentityService = require("../../modules/identity/IdentityService");
const GovernmentService = require("../../modules/government/GovernmentService");
const RpService = require("../../modules/rp/RpService");
const StaffCheckinService = require("../../modules/staff/StaffCheckinService");
const QuestService = require("../../modules/quests/QuestService");
const EmbedService = require("../../modules/builder/EmbedService");
const CustomCommandService = require("../../modules/builder/CustomCommandService");
const EconomyService = require("../../modules/economy/EconomyService");
const ViolationService = require("../../modules/violations/ViolationService");
const FlightService = require("../../modules/flights/FlightService");
const ApplicationService = require("../../modules/applications/ApplicationService");
const DMFlowService = require("../../modules/applications/DMFlowService");
const QuizService = require("../../modules/quiz/QuizService");
const LifecycleService = require("../../modules/lifecycle/LifecycleService");
const AutoReplyService = require("../../modules/autoreply/AutoReplyService");
const StarboardService = require("../../modules/starboard/StarboardService");
const InvoiceService = require("../../modules/economy/InvoiceService");
const AbuseGuard = require("../../modules/oversight/AbuseGuard");
const LockdownService = require("../../modules/oversight/LockdownService");
const ReportService = require("../../modules/reports/ReportService");
const ReactionReplyService = require("../../modules/reactionreply/ReactionReplyService");
const ChangelogService = require("../../modules/devtools/ChangelogService");
const BackupService = require("../database/BackupService");
const HealthServer = require("../server/HealthServer");

/**
 * حاوية التطبيق.
 * كل نظام يحصل على اعتمادياته عبر هذا الكائن بدل استيراد بعضه مباشرة،
 * فيبقى الفصل بين الأنظمة حقيقيًا ويسهل استبدال أي طبقة لاحقًا.
 */
class Application {
  constructor() {
    this.config = new ConfigService();
    this.logger = new Logger(this.config.env.logLevel);
    this.i18n = new I18n(this.config.bot.language);
    this.bus = new EventBus(this.logger);
    this.maintenance = false;
  }

  async init() {
    const missing = this.config.validate();
    if (missing.length) {
      this.logger.error(`متغيرات بيئة ناقصة: ${missing.join(", ")}`);
      this.logger.error("انسخ .env.example إلى .env وعبّي القيم المطلوبة.");
      process.exit(1);
    }

    // ---- قاعدة البيانات ----
    this.database = new DatabaseService(this.logger, this.config.env.databasePath);
    const db = this.database.connect();

    this.guilds = new GuildRepository(db);
    this.cases = new CaseRepository(db);
    this.staff = new StaffRepository(db);
    this.errorRepo = new ErrorRepository(db);
    this.tickets = new TicketRepository(db);
    this.activity = new ActivityRepository(db);
    this.giveaways = new GiveawayRepository(db);
    this.polls = new PollRepository(db);
    this.elections = new ElectionRepository(db);
    this.social = new SocialRepository(db);
    this.military = new MilitaryRepository(db);
    this.identities = new IdentityRepository(db);
    this.government = new GovernmentRepository(db);
    this.rp = new RpRepository(db);
    this.quests = new QuestRepository(db);
    this.selfRoles = new SelfRoleRepository(db);
    this.embeds = new EmbedRepository(db);
    this.customCommands = new CustomCommandRepository(db);
    this.economy = new EconomyRepository(db);
    this.violations = new ViolationRepository(db);
    this.flights = new FlightRepository(db);
    this.ticketTypes = new TicketTypeRepository(db);
    this.applications = new ApplicationRepository(db);
    this.quiz = new QuizRepository(db);
    this.lifecycle = new LifecycleRepository(db);
    this.autoReplies = new AutoReplyRepository(db);
    this.starboard = new StarboardRepository(db);
    this.invoices = new InvoiceRepository(db);
    this.oversight = new OversightRepository(db);
    this.reports = new ReportRepository(db);
    this.reactionReplies = new ReactionReplyRepository(db);
    this.featured = new FeaturedRepository(db);
    this.changelogs = new ChangelogRepository(db);
    this.githubWebhooks = new GithubWebhookRepository(db);

    this.guildConfig = new GuildConfigService(
      this.guilds,
      this.config.guildDefaults,
      this.config.bot.limits.guildConfigCacheMs
    );

    // ---- العميل ----
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions
      ],
      partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.Reaction, Partials.User]
    });

    // ---- الخدمات الأساسية ----
    this.permissions = new PermissionService({
      config: this.config,
      guildConfig: this.guildConfig,
      staffRepo: this.staff
    });

    this.errors = new ErrorHandler({
      logger: this.logger,
      errorRepo: this.errorRepo,
      config: this.config,
      i18n: this.i18n,
      guildConfig: this.guildConfig,
      bus: this.bus,
      client: this.client
    });
    this.errors.installGlobalHandlers();

    this.registry = new CommandRegistry(this.logger);
    this.registry.load();

    this.commands = new CommandHandler(this);
    this.interactions = new InteractionRouter(this);
    this.interactions.load();

    // ---- أنظمة الوحدات ----
    this.moderation = new ModerationService(this);
    this.ticketService = new TicketService(this);
    this.ticketAutomation = new TicketAutomation(this);
    this.staffService = new StaffService(this);
    this.security = new SecurityService(this);
    this.giveawayService = new GiveawayService(this);
    this.pollService = new PollService(this);
    this.electionService = new ElectionService(this);
    this.socialService = new SocialService(this);
    this.militaryService = new MilitaryService(this);
    this.identityService = new IdentityService(this);
    this.governmentService = new GovernmentService(this);
    this.rpService = new RpService(this);
    this.staffCheckin = new StaffCheckinService(this);
    this.questService = new QuestService(this);
    this.embedService = new EmbedService(this);
    this.customCommandService = new CustomCommandService(this);
    this.economyService = new EconomyService(this);
    this.invoiceService = new InvoiceService(this);
    this.violationService = new ViolationService(this);
    this.flightService = new FlightService(this);
    this.applicationService = new ApplicationService(this);
    this.dmFlow = new DMFlowService(this);
    this.quizService = new QuizService(this);
    this.lifecycleService = new LifecycleService(this);
    this.autoReplyService = new AutoReplyService(this);
    this.autoReplies.onChange = (guildId) => this.autoReplyService.invalidate(guildId);
    this.starboardService = new StarboardService(this);
    this.abuseGuard = new AbuseGuard(this);
    this.lockdownService = new LockdownService(this);
    this.reportService = new ReportService(this);
    this.reactionReplyService = new ReactionReplyService(this);
    this.reactionReplies.onChange = (guildId) => this.reactionReplyService.invalidate(guildId);
    this.changelogService = new ChangelogService(this);
    this.backups = new BackupService(this);
    this.health = new HealthServer(this);
    // أي تعديل على الأوامر المخصصة يُبطل كاش الخدمة فورًا
    this.customCommands.onChange = (guildId) => this.customCommandService.invalidate(guildId);

    this.logs = new LogService(this);
    this.logs.register();

    return this;
  }

  registerEvents() {
    const events = require("../../events");
    for (const [name, handler] of Object.entries(events)) {
      const once = name === "ready" || name === "clientReady";
      const wrapped = (...args) => {
        Promise.resolve(handler(this, ...args)).catch((err) =>
          this.errors.capture(err, { system: `events/${name}` })
        );
      };
      if (once) this.client.once(name, wrapped);
      else this.client.on(name, wrapped);
    }
    this.security.register();
    this.logger.info(`تم ربط ${Object.keys(events).length} حدث ديسكورد.`);
  }

  async start() {
    this.registerEvents();
    await this.client.login(this.config.env.token);
  }

  /**
   * تُنادى بعد نجاح تسجيل الدخول. لا يجب أن تفشل أبدًا: فشلها كان سابقًا
   * يوقف تنفيذ ready() عند هذا السطر بالضبط، فلا تُنشر أوامر السلاش ولا تبدأ
   * أي خدمة دورية (السحوبات، النسخ الاحتياطي، مراقب السجن...) بعده.
   * الآن أي خلل في إعدادات الحالة يُسجَّل تحذيرًا فقط ولا يوقف شيئًا.
   */
  setPresence() {
    try {
      const p = this.config.bot?.presence || {};
      this.client.user.setPresence({
        status: p.status || "online",
        activities: [
          { name: p.activityName || "إدارة السيرفر", type: ActivityType[p.activityType] ?? ActivityType.Watching }
        ]
      });
    } catch (error) {
      this.logger.warn(`تعذّر ضبط حالة البوت (Presence) — تم تجاوزها بأمان: ${error.message}`);
    }
  }

  async shutdown(code = 0) {
    this.logger.info("جارٍ الإغلاق...");
    this.giveawayService?.stop();
    this.dmFlow?.stop();
    this.lifecycleService?.stop();
    this.backups?.stop();
    this.abuseGuard?.stop();
    this.ticketAutomation?.stop();
    this.reportService?.stop();
    this.health?.stop();
    this.pollService?.stop();
    this.rpService?.stop();
    this.staffCheckin?.stop();
    this.questService?.stop();
    try {
      this.database?.close();
    } catch { /* الإغلاق أثناء الإطفاء لا يجب أن يرمي */ }
    this.client?.destroy();
    process.exit(code);
  }
}

module.exports = Application;
