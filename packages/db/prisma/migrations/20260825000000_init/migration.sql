-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "defaultReceivableAccountId" TEXT,
    "defaultPayableAccountId" TEXT,
    "defaultCashAccountId" TEXT,
    "defaultBankAccountId" TEXT,
    "defaultIncomeAccountId" TEXT,
    "defaultExpenseAccountId" TEXT,
    "defaultStockInHandAccountId" TEXT,
    "defaultCogsAccountId" TEXT,
    "defaultStockReceivedButNotBilledAccountId" TEXT,
    "defaultSalaryExpenseAccountId" TEXT,
    "defaultEmployeePayableAccountId" TEXT,
    "defaultStatutoryPayableAccountId" TEXT,
    "defaultFxGainLossAccountId" TEXT,
    "defaultLoanReceivableAccountId" TEXT,
    "defaultInterestIncomeAccountId" TEXT,
    "defaultRetainedEarningsAccountId" TEXT,
    "defaultRoundOffAccountId" TEXT,
    "defaultStockAdjustmentAccountId" TEXT,
    "defaultSellingPriceListId" TEXT,
    "defaultBuyingPriceListId" TEXT,
    "defaultHolidayListId" TEXT,
    "baseCurrency" TEXT NOT NULL DEFAULT 'INR',
    "companyGstin" TEXT,
    "homeStateCode" TEXT,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "totpSecret" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "totp_backup_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "totp_backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "action" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "statusField" TEXT NOT NULL DEFAULT 'status',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_states" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "stateName" TEXT NOT NULL,
    "docStatus" INTEGER NOT NULL DEFAULT 0,
    "style" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "workflow_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transitions" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "actionLabel" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "allowedRoles" TEXT[],

    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "linkedDoctype" TEXT NOT NULL,
    "linkedId" TEXT NOT NULL,
    "addressType" TEXT NOT NULL DEFAULT 'Billing',
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "pincode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "linkedDoctype" TEXT NOT NULL,
    "linkedId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "designation" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "applyOn" TEXT NOT NULL DEFAULT 'Selling',
    "itemId" TEXT,
    "customerId" TEXT,
    "customerGroupId" TEXT,
    "territoryId" TEXT,
    "minQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "maxQty" DECIMAL(18,4),
    "ruleType" TEXT NOT NULL DEFAULT 'Discount %',
    "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "ratePrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3),
    "validUpto" TIMESTAMP(3),
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'Monthly',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextGenerationDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "taxTemplateId" TEXT,
    "autoSubmit" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_items" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "subscription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_terms_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_terms_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_terms_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "invoicePortion" DECIMAL(5,2) NOT NULL,
    "dueDays" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payment_terms_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "budget" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "expectedRevenue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Planned',
    "channel" TEXT NOT NULL DEFAULT 'Email',
    "subject" TEXT,
    "bodyHtml" TEXT,
    "fromEmail" TEXT,
    "fromName" TEXT,
    "replyTo" TEXT,
    "trackOpens" BOOLEAN NOT NULL DEFAULT true,
    "trackClicks" BOOLEAN NOT NULL DEFAULT true,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalOpened" INTEGER NOT NULL DEFAULT 0,
    "totalClicked" INTEGER NOT NULL DEFAULT 0,
    "totalBounced" INTEGER NOT NULL DEFAULT 0,
    "totalUnsubs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactType" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "emailTo" TEXT NOT NULL,
    "trackingId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "clickedAt" TIMESTAMP(3),
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "bouncedAt" TIMESTAMP(3),
    "bounceReason" TEXT,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_lists" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDynamic" BOOLEAN NOT NULL DEFAULT false,
    "filterJson" JSONB,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_list_members" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "contactType" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_list_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_list_links" (
    "campaignId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,

    CONSTRAINT "campaign_list_links_pkey" PRIMARY KEY ("campaignId","listId")
);

-- CreateTable
CREATE TABLE "email_sequences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerType" TEXT NOT NULL DEFAULT 'Manual',
    "triggerListId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "totalEnrolled" INTEGER NOT NULL DEFAULT 0,
    "totalCompleted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_sequence_steps" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 1,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,

    CONSTRAINT "email_sequence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_enrollments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "contactType" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "emailTo" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextSendAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "siq_visitors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "displayName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "country" TEXT,
    "city" TEXT,
    "referrer" TEXT,
    "currentUrl" TEXT,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "linkedLeadId" TEXT,

    CONSTRAINT "siq_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "siq_page_views" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "referrer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "siq_page_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "siq_chat_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "operatorUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "subject" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "unreadForOperator" INTEGER NOT NULL DEFAULT 0,
    "unreadForVisitor" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "siq_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "siq_chat_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "siq_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "siq_widget_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL DEFAULT 'Support',
    "greeting" TEXT NOT NULL DEFAULT 'Hi! How can we help?',
    "primaryColor" TEXT NOT NULL DEFAULT '#7C3AED',
    "position" TEXT NOT NULL DEFAULT 'bottom-right',
    "botEnabled" BOOLEAN NOT NULL DEFAULT true,
    "botFlowJson" JSONB,
    "offlineMessage" TEXT NOT NULL DEFAULT 'We''re offline. Leave a message and we''ll email you.',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "siq_widget_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk_tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'New',
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "type" TEXT NOT NULL DEFAULT 'Question',
    "channel" TEXT NOT NULL DEFAULT 'Manual',
    "requesterEmail" TEXT,
    "requesterName" TEXT,
    "requesterPhone" TEXT,
    "linkedCustomerId" TEXT,
    "linkedLeadId" TEXT,
    "portalTicketId" TEXT,
    "assigneeUserId" TEXT,
    "teamId" TEXT,
    "slaPolicyId" TEXT,
    "firstResponseDueAt" TIMESTAMP(3),
    "resolutionDueAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "onHoldAt" TIMESTAMP(3),
    "slaFirstResponseBreached" BOOLEAN NOT NULL DEFAULT false,
    "slaResolutionBreached" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[],
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desk_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk_ticket_replies" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'Public',
    "authorType" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desk_ticket_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk_sla_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT false,
    "rulesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desk_sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk_assignment_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ruleType" TEXT NOT NULL DEFAULT 'RoundRobin',
    "agentUserIds" TEXT[],
    "matchConditions" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "rrCursor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desk_assignment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk_canned_responses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desk_canned_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk_time_entries" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "notes" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desk_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk_csat_ratings" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "ratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desk_csat_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_forms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "submitLabel" TEXT NOT NULL DEFAULT 'Submit',
    "successMessage" TEXT NOT NULL DEFAULT 'Thanks — we''ll be in touch shortly.',
    "redirectUrl" TEXT,
    "targetType" TEXT NOT NULL DEFAULT 'Lead',
    "addToListId" TEXT,
    "triggerSequenceId" TEXT,
    "fieldsJson" JSONB NOT NULL,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_form_submissions" (
    "id" TEXT NOT NULL,
    "webFormId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fieldsJson" JSONB NOT NULL,
    "createdLeadId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "referrer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_pages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "bodyHtml" TEXT NOT NULL,
    "headHtml" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "linkedWebFormId" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "conversionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_page_views" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "referrer" TEXT,
    "utm" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "landing_page_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surveys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thankYouMessage" TEXT NOT NULL DEFAULT 'Thanks for your feedback!',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "closeAt" TIMESTAMP(3),
    "responseCap" INTEGER,
    "responseCount" INTEGER NOT NULL DEFAULT 0,
    "settingsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_questions" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "optionsJson" JSONB,
    "configJson" JSONB,

    CONSTRAINT "survey_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_responses" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "respondentEmail" TEXT,
    "respondentName" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_answers" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "survey_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "addedByUserId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaUrls" TEXT[],
    "linkUrl" TEXT,
    "channelIds" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_post_results" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platformPostId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "publishedAt" TIMESTAMP(3),
    "error" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "social_post_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_monitors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "platforms" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_mentions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT,
    "authorHandle" TEXT NOT NULL,
    "authorName" TEXT,
    "authorAvatar" TEXT,
    "content" TEXT NOT NULL,
    "linkUrl" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "keyword" TEXT,
    "sentiment" TEXT NOT NULL DEFAULT 'Neutral',
    "isReplied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliq_channels" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cliq_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliq_channel_members" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "cliq_channel_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliq_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "threadParentId" TEXT,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliq_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliq_reactions" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliq_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_persons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT,
    "defaultCommissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_programs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pointsPerCurrency" DECIMAL(18,6) NOT NULL DEFAULT 0.01,
    "minRedemptionPoints" INTEGER NOT NULL DEFAULT 0,
    "maxRedemptionPercent" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "expiryMonths" INTEGER NOT NULL DEFAULT 24,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_point_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL DEFAULT 'Earned',
    "points" INTEGER NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3),
    "salesInvoiceId" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_point_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_codes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "pricingRuleId" TEXT NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3),
    "validUpto" TIMESTAMP(3),
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupon_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "parentId" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "territoryName" TEXT NOT NULL,
    "parentId" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerType" TEXT NOT NULL DEFAULT 'Company',
    "customerGroup" TEXT,
    "territory" TEXT,
    "customerGroupId" TEXT,
    "territoryId" TEXT,
    "loyaltyProgramId" TEXT,
    "creditLimit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "creditLimitBypassAllowed" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "mobile" TEXT,
    "gstin" TEXT,
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierType" TEXT NOT NULL DEFAULT 'Company',
    "supplierGroup" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "gstin" TEXT,
    "taxWithholdingCategoryId" TEXT,
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_withholding_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "thresholdAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "accountId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_withholding_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemGroup" TEXT,
    "stockUom" TEXT NOT NULL DEFAULT 'Nos',
    "standardRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "hsnCode" TEXT,
    "description" TEXT,
    "isStockItem" BOOLEAN NOT NULL DEFAULT true,
    "isAsset" BOOLEAN NOT NULL DEFAULT false,
    "defaultAssetCategoryId" TEXT,
    "hasSerialNo" BOOLEAN NOT NULL DEFAULT false,
    "hasBatchNo" BOOLEAN NOT NULL DEFAULT false,
    "hasExpiryDate" BOOLEAN NOT NULL DEFAULT false,
    "inspectionRequiredBeforeReceipt" BOOLEAN NOT NULL DEFAULT false,
    "inspectionRequiredBeforeDelivery" BOOLEAN NOT NULL DEFAULT false,
    "qualityInspectionTemplateId" TEXT,
    "isSubContractedItem" BOOLEAN NOT NULL DEFAULT false,
    "defaultSalesTaxTemplateId" TEXT,
    "defaultPurchaseTaxTemplateId" TEXT,
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "conversionRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "netTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalTaxes" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "roundedTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "roundingAdjustment" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outstandingAmt" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "remarks" TEXT,
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "taxTemplateId" TEXT,
    "isReturn" BOOLEAN NOT NULL DEFAULT false,
    "returnAgainstId" TEXT,
    "salesPersonId" TEXT,
    "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "irn" TEXT,
    "irnQrPayload" TEXT,
    "irnAckNo" TEXT,
    "irnAckDate" TIMESTAMP(3),
    "irnStatus" TEXT NOT NULL DEFAULT 'NotGenerated',
    "irnLastError" TEXT,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "taxTemplateId" TEXT,
    "remarks" TEXT,
    "frequency" TEXT NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "daysUntilDue" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "nextRunDate" DATE NOT NULL,
    "lastGeneratedAt" TIMESTAMP(3),
    "generatedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoice_items" (
    "id" TEXT NOT NULL,
    "recurringInvoiceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "description" TEXT,

    CONSTRAINT "recurring_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_items" (
    "id" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "description" TEXT,
    "salesOrderItemId" TEXT,
    "deliveryNoteItemId" TEXT,
    "taxTemplateId" TEXT,

    CONSTRAINT "sales_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierInvoiceNo" TEXT,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "conversionRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "netTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalTaxes" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "roundedTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "roundingAdjustment" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outstandingAmt" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "remarks" TEXT,
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "taxTemplateId" TEXT,
    "isReturn" BOOLEAN NOT NULL DEFAULT false,
    "returnAgainstId" TEXT,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_items" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "description" TEXT,
    "purchaseReceiptItemId" TEXT,
    "taxTemplateId" TEXT,

    CONSTRAINT "purchase_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paymentType" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partyType" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "paidAmount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "conversionRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "modeOfPayment" TEXT NOT NULL DEFAULT 'Cash',
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "withholdingCategoryId" TEXT,
    "withholdingRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "withholdingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "withholdingAccountId" TEXT,
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_entry_references" (
    "id" TEXT NOT NULL,
    "paymentEntryId" TEXT NOT NULL,
    "referenceDoctype" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "payment_entry_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "rootType" TEXT NOT NULL,
    "accountType" TEXT,
    "parentId" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_accounts" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "partyType" TEXT,
    "partyId" TEXT,
    "remarks" TEXT,

    CONSTRAINT "journal_entry_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL,
    "parentId" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bins" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "actualQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "valuationRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "stockValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_ledger_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "actualQty" DECIMAL(18,4) NOT NULL,
    "qtyAfterTransaction" DECIMAL(18,4) NOT NULL,
    "incomingRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "valuationRate" DECIMAL(18,4) NOT NULL,
    "stockValue" DECIMAL(18,4) NOT NULL,
    "voucherType" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "voucherName" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_entry_items" (
    "id" TEXT NOT NULL,
    "stockEntryId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "basicRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sourceWarehouseId" TEXT,
    "targetWarehouseId" TEXT,

    CONSTRAINT "stock_entry_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "voucherType" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "voucherName" TEXT,
    "partyType" TEXT,
    "partyId" TEXT,
    "remarks" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gl_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "openingBalance" DECIMAL(18,4) NOT NULL,
    "closingBalance" DECIMAL(18,4) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedBy" TEXT NOT NULL,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "transactionDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "runningBalance" DECIMAL(18,4),
    "matchedGlEntryId" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'Unmatched',
    "reconciledAt" TIMESTAMP(3),
    "reconciledBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landed_cost_vouchers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landed_cost_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landed_cost_voucher_receipts" (
    "id" TEXT NOT NULL,
    "landedCostVoucherId" TEXT NOT NULL,
    "purchaseReceiptId" TEXT NOT NULL,

    CONSTRAINT "landed_cost_voucher_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landed_cost_voucher_taxes" (
    "id" TEXT NOT NULL,
    "landedCostVoucherId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "landed_cost_voucher_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_note_items" (
    "id" TEXT NOT NULL,
    "deliveryNoteId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "salesOrderItemId" TEXT,
    "serialNumbersInput" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "batchNo" TEXT,
    "uom" TEXT,
    "conversionFactor" DECIMAL(18,6),
    "stockQty" DECIMAL(18,4),

    CONSTRAINT "delivery_note_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "materialRequestType" TEXT NOT NULL DEFAULT 'Purchase',
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requiredDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_request_items" (
    "id" TEXT NOT NULL,
    "materialRequestId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "warehouseId" TEXT,
    "requiredDate" TIMESTAMP(3),
    "orderedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "material_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reconciliations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purpose" TEXT NOT NULL DEFAULT 'Stock Reconciliation',
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reconciliation_items" (
    "id" TEXT NOT NULL,
    "stockReconciliationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "currentQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currentValuationRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "countedQty" DECIMAL(18,4) NOT NULL,
    "countedValuationRate" DECIMAL(18,4),

    CONSTRAINT "stock_reconciliation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "conversionRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "netTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalTaxes" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxTemplateId" TEXT,
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "isSubcontracted" BOOLEAN NOT NULL DEFAULT false,
    "supplierWarehouseId" TEXT,
    "sourceWarehouseId" TEXT,
    "subcontractedTransferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "warehouseId" TEXT,
    "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "taxTemplateId" TEXT,
    "materialRequestItemId" TEXT,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_taxes" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL,
    "accountId" TEXT NOT NULL,
    "taxTemplateId" TEXT,
    "chargeType" TEXT NOT NULL DEFAULT 'On Net Total',

    CONSTRAINT "purchase_order_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierDeliveryNo" TEXT,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipt_items" (
    "id" TEXT NOT NULL,
    "purchaseReceiptId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "purchaseOrderItemId" TEXT,
    "serialNumbersInput" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "batchNo" TEXT,
    "manufactureDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "uom" TEXT,
    "conversionFactor" DECIMAL(18,6),
    "stockQty" DECIMAL(18,4),

    CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productionItemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "uom" TEXT NOT NULL DEFAULT 'Nos',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "totalCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "costUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_items" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'Nos',
    "rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "bom_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "productionItemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "producedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sourceWarehouseId" TEXT NOT NULL,
    "targetWarehouseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Not Started',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leadName" TEXT NOT NULL,
    "companyName" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "source" TEXT,
    "remarks" TEXT,
    "convertedCustomerId" TEXT,
    "campaignId" TEXT,
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "parentType" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "priority" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "callDirection" TEXT,
    "callDuration" INTEGER,
    "callOutcome" TEXT,
    "phoneNumber" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "location" TEXT,
    "meetingUrl" TEXT,
    "emailFrom" TEXT,
    "emailTo" TEXT,
    "emailCc" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partyType" TEXT NOT NULL,
    "leadId" TEXT,
    "customerId" TEXT,
    "expectedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "expectedCloseDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Open',
    "source" TEXT,
    "remarks" TEXT,
    "campaignId" TEXT,
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partyType" TEXT NOT NULL,
    "leadId" TEXT,
    "customerId" TEXT,
    "quotationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTill" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "netTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxTemplateId" TEXT,
    "totalTaxes" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "remarks" TEXT,
    "customData" JSONB,
    "nextFollowUpDate" TIMESTAMP(3),
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "description" TEXT,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "quotationId" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "netTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxTemplateId" TEXT,
    "totalTaxes" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "invoicedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "remarks" TEXT,
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_items" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "description" TEXT,
    "billedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "deliveredQty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT,
    "designation" TEXT,
    "department" TEXT,
    "dateOfJoining" TIMESTAMP(3),
    "baseSalary" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bankAccountNo" TEXT,
    "salaryStructureId" TEXT,
    "defaultShiftId" TEXT,
    "holidayListId" TEXT,
    "leavePolicyId" TEXT,
    "gradeId" TEXT,
    "employmentTypeId" TEXT,
    "branchId" TEXT,
    "customData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "shiftId" TEXT,
    "remarks" TEXT,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "workingHours" DECIMAL(6,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_encashments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "encashmentDate" DATE NOT NULL,
    "days" DECIMAL(9,2) NOT NULL,
    "dailyRate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "modeOfPayment" TEXT NOT NULL DEFAULT 'Bank',
    "paymentJournalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_encashments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_skills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "proficiency" TEXT NOT NULL,
    "yearsOfExperience" DECIMAL(6,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_certifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "certificationName" TEXT NOT NULL,
    "issuer" TEXT,
    "issueDate" DATE,
    "expiryDate" DATE,
    "credentialId" TEXT,
    "credentialUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_grades" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultBaseSalary" DECIMAL(18,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employment_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "trainerName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_attendees" (
    "id" TEXT NOT NULL,
    "trainingEventId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_openings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT,
    "designation" TEXT,
    "description" TEXT,
    "location" TEXT,
    "employmentType" TEXT,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_openings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applicants" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "applicantName" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT,
    "coverLetter" TEXT,
    "resumeUrl" TEXT,
    "source" TEXT,
    "jobOpeningId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'New',
    "hiredEmployeeId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_applicants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statutory_components" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slipComponentName" TEXT NOT NULL,
    "employeeSharePercent" DECIMAL(6,3) NOT NULL,
    "employerSharePercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "monthlyGrossCeiling" DECIMAL(18,4),
    "flatAmount" DECIMAL(18,4),
    "applicableFrom" DATE NOT NULL,
    "applicableTo" DATE,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statutory_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_policy_details" (
    "id" TEXT NOT NULL,
    "leavePolicyId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "annualAllocation" DECIMAL(9,2) NOT NULL,

    CONSTRAINT "leave_policy_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overtime_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "otDate" DATE NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "hourlyRate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "overtime_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_regularizations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "requestedStatus" TEXT NOT NULL,
    "requestedCheckIn" TIMESTAMP(3),
    "requestedCheckOut" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_regularizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_checkins" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "logType" TEXT NOT NULL,
    "source" TEXT,
    "deviceId" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_slips" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "grossPay" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalDeduction" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_slips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_slip_components" (
    "id" TEXT NOT NULL,
    "salarySlipId" TEXT NOT NULL,
    "componentName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "salary_slip_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_plan_items" (
    "id" TEXT NOT NULL,
    "productionPlanId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "plannedQty" DECIMAL(18,4) NOT NULL,
    "producedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "salesOrderItemId" TEXT,

    CONSTRAINT "production_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_plan_raw_materials" (
    "id" TEXT NOT NULL,
    "productionPlanId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "requiredQty" DECIMAL(18,4) NOT NULL,
    "availableQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "shortfallQty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "production_plan_raw_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_reorder_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "reorderLevel" DECIMAL(18,4) NOT NULL,
    "reorderQty" DECIMAL(18,4) NOT NULL,
    "materialRequestType" TEXT NOT NULL DEFAULT 'Purchase',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_reorder_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serial_numbers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "purchaseReceiptItemId" TEXT,
    "deliveryNoteItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "serial_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "manufactureDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "batchQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_uom_conversions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "conversionFactor" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_uom_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_inspection_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "parameter" TEXT NOT NULL,
    "acceptanceCriteria" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quality_inspection_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inspectionType" TEXT NOT NULL DEFAULT 'Incoming',
    "reportDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemId" TEXT NOT NULL,
    "templateId" TEXT,
    "purchaseReceiptItemId" TEXT,
    "deliveryNoteItemId" TEXT,
    "overallStatus" TEXT NOT NULL DEFAULT 'Accepted',
    "inspectedBy" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection_readings" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "parameter" TEXT NOT NULL,
    "acceptanceCriteria" TEXT,
    "reading" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Accepted',

    CONSTRAINT "quality_inspection_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "buyingOrSelling" TEXT NOT NULL DEFAULT 'Selling',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_prices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "priceListRate" DECIMAL(18,4) NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validUpto" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateType" TEXT NOT NULL,
    "rate" DECIMAL(9,4),
    "accountId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretHash" TEXT,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "grantTypes" TEXT[],
    "scopes" TEXT[],
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isTrusted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_auth_codes" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "scopes" TEXT[],
    "codeChallenge" TEXT,
    "codeChallengeMethod" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_auth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_access_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_refresh_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "accessTokenId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_consents" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "doctype" TEXT,
    "docId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "statusCode" INTEGER NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "naming_series_counters" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "naming_series_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_template_rows" (
    "id" TEXT NOT NULL,
    "taxTemplateId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "accountId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "chargeType" TEXT NOT NULL DEFAULT 'On Net Total',
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "tax_template_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_taxes" (
    "id" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL,
    "accountId" TEXT NOT NULL,
    "taxTemplateId" TEXT,
    "chargeType" TEXT NOT NULL DEFAULT 'On Net Total',

    CONSTRAINT "sales_invoice_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_taxes" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL,
    "accountId" TEXT NOT NULL,
    "taxTemplateId" TEXT,
    "chargeType" TEXT NOT NULL DEFAULT 'On Net Total',

    CONSTRAINT "purchase_invoice_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_taxes" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL,
    "accountId" TEXT NOT NULL,
    "taxTemplateId" TEXT,
    "chargeType" TEXT NOT NULL DEFAULT 'On Net Total',

    CONSTRAINT "quotation_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_taxes" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL,
    "accountId" TEXT NOT NULL,
    "taxTemplateId" TEXT,
    "chargeType" TEXT NOT NULL DEFAULT 'On Net Total',

    CONSTRAINT "sales_order_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "closedTill" DATE,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "annualAmount" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leaveTypeName" TEXT NOT NULL,
    "isEncashable" BOOLEAN NOT NULL DEFAULT false,
    "maxDaysPerYear" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "totalLeaves" DECIMAL(9,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_applications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "halfDay" BOOLEAN NOT NULL DEFAULT false,
    "totalLeaveDays" DECIMAL(9,2) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appraisal_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appraisal_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appraisal_template_goals" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "kra" TEXT NOT NULL,
    "description" TEXT,
    "weightPercent" DECIMAL(6,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "appraisal_template_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appraisals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "templateId" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "finalScore" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "appraiserId" TEXT,
    "employeeRemarks" TEXT,
    "appraiserRemarks" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appraisals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appraisal_goals" (
    "id" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "kra" TEXT NOT NULL,
    "description" TEXT,
    "weightPercent" DECIMAL(6,2) NOT NULL,
    "score" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "weightedScore" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "appraisal_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_advances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "postingDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purpose" TEXT NOT NULL,
    "advanceAmount" DECIMAL(18,4) NOT NULL,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "returnAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "modeOfPayment" TEXT NOT NULL DEFAULT 'Bank',
    "advanceAccountId" TEXT,
    "remarks" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_checklist_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_checklist_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "description" TEXT,
    "role" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "employee_checklist_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_checklists" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "templateId" TEXT,
    "startDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'InProgress',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_checklist_activities" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "description" TEXT,
    "role" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "employee_checklist_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "postingDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "department" TEXT,
    "designation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "totalGross" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalDeduction" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "slipsCount" INTEGER NOT NULL DEFAULT 0,
    "paymentMode" TEXT NOT NULL DEFAULT 'Bank',
    "payoutJournalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_entry_employees" (
    "id" TEXT NOT NULL,
    "payrollEntryId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "salarySlipId" TEXT,
    "gross" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "deduction" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "net" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "payroll_entry_employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_lists" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "weeklyOffDay" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holiday_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "holidayListId" TEXT NOT NULL,
    "holidayDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "isWeeklyOff" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_structure_components" (
    "id" TEXT NOT NULL,
    "salaryStructureId" TEXT NOT NULL,
    "componentName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "formula" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "salary_structure_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "workingHours" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claim_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "typeName" TEXT NOT NULL,
    "expenseAccountId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_claim_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claims" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claim_items" (
    "id" TEXT NOT NULL,
    "expenseClaimId" TEXT NOT NULL,
    "expenseClaimTypeId" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "expenseAccountId" TEXT,

    CONSTRAINT "expense_claim_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanTypeName" TEXT NOT NULL,
    "interestRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "defaultTermMonths" INTEGER NOT NULL DEFAULT 12,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "loanTypeId" TEXT NOT NULL,
    "principal" DECIMAL(18,4) NOT NULL,
    "interestRate" DECIMAL(9,4) NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "emi" DECIMAL(18,4) NOT NULL,
    "disbursementDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "outstanding" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_repayment_schedules" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "principalAmount" DECIMAL(18,4) NOT NULL,
    "interestAmount" DECIMAL(18,4) NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "balanceAfter" DECIMAL(18,4) NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "paidVoucherType" TEXT,
    "paidVoucherId" TEXT,

    CONSTRAINT "loan_repayment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "customerId" TEXT,
    "projectManagerId" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "billingType" TEXT NOT NULL DEFAULT 'Non-billable',
    "estimatedCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "actualCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "budgetAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "budgetSpent" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "budgetThresholdPct" INTEGER NOT NULL DEFAULT 80,
    "fromTemplateId" TEXT,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "assignedEmployeeId" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "expectedHours" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "actualHours" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parentTaskId" TEXT,
    "milestoneId" TEXT,
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'Upcoming',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" TEXT NOT NULL,
    "fromTaskId" TEXT NOT NULL,
    "toTaskId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "billingType" TEXT NOT NULL DEFAULT 'Non-billable',
    "defaultBudget" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "structureJson" JSONB NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agile_workspaces" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agile_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprints" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Planning',
    "startDate" DATE,
    "endDate" DATE,
    "actualStartAt" TIMESTAMP(3),
    "actualEndAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epics" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'violet',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "targetDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "epics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "releases" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetDate" DATE,
    "releasedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Planned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_items" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Todo',
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "points" INTEGER,
    "assigneeUserIds" TEXT[],
    "reporterUserId" TEXT,
    "parentWorkItemId" TEXT,
    "epicId" TEXT,
    "sprintId" TEXT,
    "releaseId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "labels" TEXT[],
    "dueDate" DATE,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "okrs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OnTrack',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "okrs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_results" (
    "id" TEXT NOT NULL,
    "okrId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "currentValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "key_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "weekStartDate" DATE NOT NULL,
    "totalHours" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "totalBillableHours" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "totalBillingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_lines" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "date" DATE NOT NULL,
    "hours" DECIMAL(9,2) NOT NULL,
    "isBillable" BOOLEAN NOT NULL DEFAULT false,
    "billingRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "billingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "salesInvoiceItemId" TEXT,

    CONSTRAINT "timesheet_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "assetAccountId" TEXT NOT NULL,
    "accumDepreciationAccountId" TEXT NOT NULL,
    "depExpenseAccountId" TEXT NOT NULL,
    "defaultUsefulLifeMonths" INTEGER NOT NULL DEFAULT 36,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "assetName" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "purchaseDate" DATE NOT NULL,
    "purchasePrice" DECIMAL(18,4) NOT NULL,
    "salvageValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "depreciationMethod" TEXT NOT NULL DEFAULT 'Straight Line',
    "wdvAnnualRatePct" DECIMAL(9,4),
    "sourcePurchaseInvoiceItemId" TEXT,
    "currentValue" DECIMAL(18,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "location" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_depreciation_schedules" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "balanceAfter" DECIMAL(18,4) NOT NULL,
    "isBooked" BOOLEAN NOT NULL DEFAULT false,
    "bookedAt" TIMESTAMP(3),
    "bookedBy" TEXT,

    CONSTRAINT "asset_depreciation_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_maintenance_logs" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "maintenanceType" TEXT NOT NULL,
    "cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "performedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_maintenance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workstations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hourRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "workingHoursPerDay" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workstations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_operations" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "operationName" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "timeInMins" DECIMAL(10,2) NOT NULL,
    "hourRate" DECIMAL(18,4) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bom_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_operations" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "operationName" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "timeInMins" DECIMAL(10,2) NOT NULL,
    "hourRate" DECIMAL(18,4) NOT NULL,
    "completedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "actualTimeMins" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_order_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_cards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "employeeId" TEXT,
    "employeeName" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "totalTimeMins" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_card_time_logs" (
    "id" TEXT NOT NULL,
    "jobCardId" TEXT NOT NULL,
    "fromTime" TIMESTAMP(3) NOT NULL,
    "toTime" TIMESTAMP(3),
    "minutes" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "job_card_time_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "options" JSONB,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "helpText" TEXT,
    "regexPattern" TEXT,
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "readOnly" BOOLEAN NOT NULL DEFAULT false,
    "hiddenIf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Received',
    "requestedBy" TEXT,
    "outputPath" TEXT,
    "completedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_retention_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "retainDays" INTEGER NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'anonymize',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "essential" BOOLEAN NOT NULL DEFAULT true,
    "analytics" BOOLEAN NOT NULL DEFAULT false,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "policyVersion" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymization_archives" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "dsrId" TEXT,
    "cipher" JSONB NOT NULL,
    "fieldsChanged" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "anonymization_archives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPercent" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'full',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "outputPath" TEXT,
    "sizeBytes" BIGINT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "service" TEXT NOT NULL,
    "requestId" TEXT,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "userId" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_integrations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secrets" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signingSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "integrationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Received',
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "partyType" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "displayName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_invites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "partyType" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "priority" TEXT NOT NULL DEFAULT 'Normal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_ticket_replies" (
    "id" TEXT NOT NULL,
    "portalTicketId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_ticket_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "fileName" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'create',
    "keyField" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "succeededRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job_rows" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "action" TEXT,
    "targetId" TEXT,
    "errorMessage" TEXT,
    "rawJson" JSONB NOT NULL,

    CONSTRAINT "import_job_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_presets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "columns" JSONB NOT NULL,
    "filters" JSONB,
    "sortBy" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list_views" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "columns" JSONB NOT NULL,
    "filters" JSONB,
    "sortBy" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "list_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "sharedRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letterheads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoBase64" TEXT,
    "addressText" TEXT,
    "footerText" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "appliesToDoctypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "letterheads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_formats" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "headerText" TEXT,
    "footerText" TEXT,
    "thankYouNote" TEXT,
    "termsText" TEXT,
    "showItemDescription" BOOLEAN NOT NULL DEFAULT true,
    "showTaxBreakdown" BOOLEAN NOT NULL DEFAULT true,
    "showRemarks" BOOLEAN NOT NULL DEFAULT true,
    "paperSize" TEXT NOT NULL DEFAULT 'A4',
    "orientation" TEXT NOT NULL DEFAULT 'portrait',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_formats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_cards" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "config" JSONB NOT NULL,
    "gridCol" INTEGER NOT NULL DEFAULT 0,
    "gridRow" INTEGER NOT NULL DEFAULT 0,
    "gridWidth" INTEGER NOT NULL DEFAULT 4,
    "gridHeight" INTEGER NOT NULL DEFAULT 2,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dashboard_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_bookmarks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_bookmarks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "savedReportId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_share_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "label" TEXT,
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "savedReportId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "hourOfDay" INTEGER NOT NULL DEFAULT 9,
    "dayOfWeek" INTEGER NOT NULL DEFAULT 1,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "emailTo" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learn_courses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coverColor" TEXT NOT NULL DEFAULT 'violet',
    "category" TEXT,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learn_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learn_lessons" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "quiz" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "durationMinutes" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learn_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learn_enrollments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "currentLessonId" TEXT,

    CONSTRAINT "learn_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learn_lesson_progress" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quizScore" INTEGER,
    "quizPassed" BOOLEAN,

    CONSTRAINT "learn_lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learn_certificates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learn_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notebooks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'violet',
    "icon" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notebooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Mixed',
    "tags" TEXT[],
    "color" TEXT NOT NULL DEFAULT 'default',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "reminderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workdrive_folders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workdrive_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workdrive_files" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "folderId" TEXT,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workdrive_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workdrive_file_versions" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" BYTEA,
    "storageKey" TEXT,
    "uploadedByUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workdrive_file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workdrive_share_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "label" TEXT,
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workdrive_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workdrive_comments" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workdrive_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA,
    "storageKey" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "doctype" TEXT,
    "docId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL DEFAULT 'direct',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "ccEmail" TEXT,
    "bccEmail" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "templateId" TEXT,
    "senderUserId" TEXT,
    "linkedDoctype" TEXT,
    "linkedId" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "toMobile" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "templateId" TEXT,
    "senderUserId" TEXT,
    "linkedDoctype" TEXT,
    "linkedId" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digest_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "hourOfDay" INTEGER NOT NULL DEFAULT 9,
    "dayOfWeek" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digest_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "templateId" TEXT,
    "audience" TEXT NOT NULL,
    "filter" JSONB,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "todos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dueDate" DATE,
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "doctype" TEXT,
    "docId" TEXT,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "todos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_jti_key" ON "user_sessions"("jti");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");

-- CreateIndex
CREATE INDEX "user_sessions_jti_idx" ON "user_sessions"("jti");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_userId_idx" ON "email_verification_tokens"("userId");

-- CreateIndex
CREATE INDEX "totp_backup_codes_userId_idx" ON "totp_backup_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_roleName_key" ON "roles"("tenantId", "roleName");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");

-- CreateIndex
CREATE INDEX "role_permissions_tenantId_doctype_idx" ON "role_permissions"("tenantId", "doctype");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_doctype_action_key" ON "role_permissions"("roleId", "doctype", "action");

-- CreateIndex
CREATE INDEX "workflows_tenantId_doctype_isActive_idx" ON "workflows"("tenantId", "doctype", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_tenantId_name_key" ON "workflows"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_states_workflowId_stateName_key" ON "workflow_states"("workflowId", "stateName");

-- CreateIndex
CREATE INDEX "workflow_transitions_workflowId_fromState_idx" ON "workflow_transitions"("workflowId", "fromState");

-- CreateIndex
CREATE INDEX "addresses_tenantId_linkedDoctype_linkedId_idx" ON "addresses"("tenantId", "linkedDoctype", "linkedId");

-- CreateIndex
CREATE INDEX "contacts_tenantId_linkedDoctype_linkedId_idx" ON "contacts"("tenantId", "linkedDoctype", "linkedId");

-- CreateIndex
CREATE INDEX "pricing_rules_tenantId_applyOn_disabled_idx" ON "pricing_rules"("tenantId", "applyOn", "disabled");

-- CreateIndex
CREATE INDEX "pricing_rules_tenantId_itemId_idx" ON "pricing_rules"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "pricing_rules_tenantId_customerId_idx" ON "pricing_rules"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "subscriptions_tenantId_status_nextGenerationDate_idx" ON "subscriptions"("tenantId", "status", "nextGenerationDate");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenantId_name_key" ON "subscriptions"("tenantId", "name");

-- CreateIndex
CREATE INDEX "subscription_items_subscriptionId_idx" ON "subscription_items"("subscriptionId");

-- CreateIndex
CREATE INDEX "payment_terms_templates_tenantId_enabled_idx" ON "payment_terms_templates"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "payment_terms_templates_tenantId_name_key" ON "payment_terms_templates"("tenantId", "name");

-- CreateIndex
CREATE INDEX "payment_terms_template_items_templateId_idx" ON "payment_terms_template_items"("templateId");

-- CreateIndex
CREATE INDEX "campaigns_tenantId_status_idx" ON "campaigns"("tenantId", "status");

-- CreateIndex
CREATE INDEX "campaigns_tenantId_scheduledFor_idx" ON "campaigns"("tenantId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_tenantId_name_key" ON "campaigns"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_trackingId_key" ON "campaign_recipients"("trackingId");

-- CreateIndex
CREATE INDEX "campaign_recipients_tenantId_campaignId_status_idx" ON "campaign_recipients"("tenantId", "campaignId", "status");

-- CreateIndex
CREATE INDEX "campaign_recipients_trackingId_idx" ON "campaign_recipients"("trackingId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaignId_contactType_contactId_key" ON "campaign_recipients"("campaignId", "contactType", "contactId");

-- CreateIndex
CREATE INDEX "contact_lists_tenantId_idx" ON "contact_lists"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_lists_tenantId_name_key" ON "contact_lists"("tenantId", "name");

-- CreateIndex
CREATE INDEX "contact_list_members_listId_idx" ON "contact_list_members"("listId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_list_members_listId_contactType_contactId_key" ON "contact_list_members"("listId", "contactType", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "email_sequences_tenantId_name_key" ON "email_sequences"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "email_sequence_steps_sequenceId_stepOrder_key" ON "email_sequence_steps"("sequenceId", "stepOrder");

-- CreateIndex
CREATE INDEX "sequence_enrollments_tenantId_status_nextSendAt_idx" ON "sequence_enrollments"("tenantId", "status", "nextSendAt");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_enrollments_sequenceId_contactType_contactId_key" ON "sequence_enrollments"("sequenceId", "contactType", "contactId");

-- CreateIndex
CREATE INDEX "siq_visitors_tenantId_status_lastSeenAt_idx" ON "siq_visitors"("tenantId", "status", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "siq_visitors_tenantId_fingerprint_key" ON "siq_visitors"("tenantId", "fingerprint");

-- CreateIndex
CREATE INDEX "siq_page_views_visitorId_createdAt_idx" ON "siq_page_views"("visitorId", "createdAt");

-- CreateIndex
CREATE INDEX "siq_chat_sessions_tenantId_status_startedAt_idx" ON "siq_chat_sessions"("tenantId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "siq_chat_messages_sessionId_createdAt_idx" ON "siq_chat_messages"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "siq_widget_settings_tenantId_key" ON "siq_widget_settings"("tenantId");

-- CreateIndex
CREATE INDEX "desk_tickets_tenantId_status_priority_idx" ON "desk_tickets"("tenantId", "status", "priority");

-- CreateIndex
CREATE INDEX "desk_tickets_tenantId_assigneeUserId_status_idx" ON "desk_tickets"("tenantId", "assigneeUserId", "status");

-- CreateIndex
CREATE INDEX "desk_tickets_tenantId_firstResponseDueAt_idx" ON "desk_tickets"("tenantId", "firstResponseDueAt");

-- CreateIndex
CREATE INDEX "desk_tickets_tenantId_resolutionDueAt_idx" ON "desk_tickets"("tenantId", "resolutionDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "desk_tickets_tenantId_name_key" ON "desk_tickets"("tenantId", "name");

-- CreateIndex
CREATE INDEX "desk_ticket_replies_ticketId_createdAt_idx" ON "desk_ticket_replies"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "desk_sla_policies_tenantId_isDefault_idx" ON "desk_sla_policies"("tenantId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "desk_sla_policies_tenantId_name_key" ON "desk_sla_policies"("tenantId", "name");

-- CreateIndex
CREATE INDEX "desk_assignment_rules_tenantId_isActive_priority_idx" ON "desk_assignment_rules"("tenantId", "isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "desk_assignment_rules_tenantId_name_key" ON "desk_assignment_rules"("tenantId", "name");

-- CreateIndex
CREATE INDEX "desk_canned_responses_tenantId_category_idx" ON "desk_canned_responses"("tenantId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "desk_canned_responses_tenantId_name_key" ON "desk_canned_responses"("tenantId", "name");

-- CreateIndex
CREATE INDEX "desk_time_entries_ticketId_idx" ON "desk_time_entries"("ticketId");

-- CreateIndex
CREATE INDEX "desk_time_entries_userId_idx" ON "desk_time_entries"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "desk_csat_ratings_ticketId_key" ON "desk_csat_ratings"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "web_forms_publicSlug_key" ON "web_forms"("publicSlug");

-- CreateIndex
CREATE INDEX "web_forms_tenantId_isActive_idx" ON "web_forms"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "web_forms_tenantId_name_key" ON "web_forms"("tenantId", "name");

-- CreateIndex
CREATE INDEX "web_form_submissions_webFormId_createdAt_idx" ON "web_form_submissions"("webFormId", "createdAt");

-- CreateIndex
CREATE INDEX "web_form_submissions_tenantId_createdAt_idx" ON "web_form_submissions"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "landing_pages_publicSlug_key" ON "landing_pages"("publicSlug");

-- CreateIndex
CREATE INDEX "landing_pages_tenantId_isPublished_idx" ON "landing_pages"("tenantId", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "landing_pages_tenantId_name_key" ON "landing_pages"("tenantId", "name");

-- CreateIndex
CREATE INDEX "landing_page_views_pageId_createdAt_idx" ON "landing_page_views"("pageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "surveys_publicSlug_key" ON "surveys"("publicSlug");

-- CreateIndex
CREATE INDEX "surveys_tenantId_isActive_idx" ON "surveys"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "surveys_tenantId_name_key" ON "surveys"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "survey_questions_surveyId_order_key" ON "survey_questions"("surveyId", "order");

-- CreateIndex
CREATE INDEX "survey_responses_surveyId_submittedAt_idx" ON "survey_responses"("surveyId", "submittedAt");

-- CreateIndex
CREATE INDEX "survey_responses_tenantId_submittedAt_idx" ON "survey_responses"("tenantId", "submittedAt");

-- CreateIndex
CREATE INDEX "survey_answers_questionId_idx" ON "survey_answers"("questionId");

-- CreateIndex
CREATE INDEX "social_accounts_tenantId_isActive_idx" ON "social_accounts"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_tenantId_platform_handle_key" ON "social_accounts"("tenantId", "platform", "handle");

-- CreateIndex
CREATE INDEX "social_posts_tenantId_status_scheduledFor_idx" ON "social_posts"("tenantId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "social_posts_tenantId_publishedAt_idx" ON "social_posts"("tenantId", "publishedAt");

-- CreateIndex
CREATE INDEX "social_post_results_accountId_idx" ON "social_post_results"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "social_post_results_postId_accountId_key" ON "social_post_results"("postId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "social_monitors_tenantId_name_key" ON "social_monitors"("tenantId", "name");

-- CreateIndex
CREATE INDEX "social_mentions_tenantId_postedAt_idx" ON "social_mentions"("tenantId", "postedAt");

-- CreateIndex
CREATE INDEX "social_mentions_tenantId_sentiment_idx" ON "social_mentions"("tenantId", "sentiment");

-- CreateIndex
CREATE INDEX "cliq_channels_tenantId_type_idx" ON "cliq_channels"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "cliq_channels_tenantId_name_type_key" ON "cliq_channels"("tenantId", "name", "type");

-- CreateIndex
CREATE INDEX "cliq_channel_members_userId_isPinned_idx" ON "cliq_channel_members"("userId", "isPinned");

-- CreateIndex
CREATE UNIQUE INDEX "cliq_channel_members_channelId_userId_key" ON "cliq_channel_members"("channelId", "userId");

-- CreateIndex
CREATE INDEX "cliq_messages_channelId_createdAt_idx" ON "cliq_messages"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "cliq_messages_channelId_threadParentId_idx" ON "cliq_messages"("channelId", "threadParentId");

-- CreateIndex
CREATE INDEX "cliq_reactions_messageId_idx" ON "cliq_reactions"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "cliq_reactions_messageId_userId_emoji_key" ON "cliq_reactions"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "sales_persons_tenantId_enabled_idx" ON "sales_persons"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "sales_persons_tenantId_name_key" ON "sales_persons"("tenantId", "name");

-- CreateIndex
CREATE INDEX "loyalty_programs_tenantId_enabled_idx" ON "loyalty_programs"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_tenantId_name_key" ON "loyalty_programs"("tenantId", "name");

-- CreateIndex
CREATE INDEX "loyalty_point_entries_tenantId_customerId_entryType_idx" ON "loyalty_point_entries"("tenantId", "customerId", "entryType");

-- CreateIndex
CREATE INDEX "loyalty_point_entries_tenantId_programId_idx" ON "loyalty_point_entries"("tenantId", "programId");

-- CreateIndex
CREATE INDEX "coupon_codes_tenantId_disabled_idx" ON "coupon_codes"("tenantId", "disabled");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_codes_tenantId_code_key" ON "coupon_codes"("tenantId", "code");

-- CreateIndex
CREATE INDEX "customer_groups_tenantId_parentId_idx" ON "customer_groups"("tenantId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_groups_tenantId_groupName_key" ON "customer_groups"("tenantId", "groupName");

-- CreateIndex
CREATE INDEX "territories_tenantId_parentId_idx" ON "territories"("tenantId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "territories_tenantId_territoryName_key" ON "territories"("tenantId", "territoryName");

-- CreateIndex
CREATE INDEX "customers_tenantId_idx" ON "customers"("tenantId");

-- CreateIndex
CREATE INDEX "suppliers_tenantId_idx" ON "suppliers"("tenantId");

-- CreateIndex
CREATE INDEX "tax_withholding_categories_tenantId_idx" ON "tax_withholding_categories"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_withholding_categories_tenantId_name_key" ON "tax_withholding_categories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "items_tenantId_idx" ON "items"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "items_tenantId_itemCode_key" ON "items"("tenantId", "itemCode");

-- CreateIndex
CREATE INDEX "sales_invoices_tenantId_status_idx" ON "sales_invoices"("tenantId", "status");

-- CreateIndex
CREATE INDEX "sales_invoices_tenantId_customerId_idx" ON "sales_invoices"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "sales_invoices_tenantId_irn_idx" ON "sales_invoices"("tenantId", "irn");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_tenantId_name_key" ON "sales_invoices"("tenantId", "name");

-- CreateIndex
CREATE INDEX "recurring_invoices_tenantId_status_nextRunDate_idx" ON "recurring_invoices"("tenantId", "status", "nextRunDate");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_invoices_tenantId_name_key" ON "recurring_invoices"("tenantId", "name");

-- CreateIndex
CREATE INDEX "recurring_invoice_items_recurringInvoiceId_idx" ON "recurring_invoice_items"("recurringInvoiceId");

-- CreateIndex
CREATE INDEX "sales_invoice_items_salesInvoiceId_idx" ON "sales_invoice_items"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "sales_invoice_items_salesOrderItemId_idx" ON "sales_invoice_items"("salesOrderItemId");

-- CreateIndex
CREATE INDEX "sales_invoice_items_deliveryNoteItemId_idx" ON "sales_invoice_items"("deliveryNoteItemId");

-- CreateIndex
CREATE INDEX "purchase_invoices_tenantId_status_idx" ON "purchase_invoices"("tenantId", "status");

-- CreateIndex
CREATE INDEX "purchase_invoices_tenantId_supplierId_idx" ON "purchase_invoices"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_tenantId_name_key" ON "purchase_invoices"("tenantId", "name");

-- CreateIndex
CREATE INDEX "purchase_invoice_items_purchaseInvoiceId_idx" ON "purchase_invoice_items"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "purchase_invoice_items_purchaseReceiptItemId_idx" ON "purchase_invoice_items"("purchaseReceiptItemId");

-- CreateIndex
CREATE INDEX "payment_entries_tenantId_status_idx" ON "payment_entries"("tenantId", "status");

-- CreateIndex
CREATE INDEX "payment_entries_tenantId_partyType_partyId_idx" ON "payment_entries"("tenantId", "partyType", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_entries_tenantId_name_key" ON "payment_entries"("tenantId", "name");

-- CreateIndex
CREATE INDEX "payment_entry_references_paymentEntryId_idx" ON "payment_entry_references"("paymentEntryId");

-- CreateIndex
CREATE INDEX "payment_entry_references_referenceDoctype_referenceId_idx" ON "payment_entry_references"("referenceDoctype", "referenceId");

-- CreateIndex
CREATE INDEX "accounts_tenantId_parentId_idx" ON "accounts"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "accounts_tenantId_rootType_idx" ON "accounts"("tenantId", "rootType");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenantId_accountName_key" ON "accounts"("tenantId", "accountName");

-- CreateIndex
CREATE INDEX "journal_entries_tenantId_status_idx" ON "journal_entries"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_tenantId_name_key" ON "journal_entries"("tenantId", "name");

-- CreateIndex
CREATE INDEX "journal_entry_accounts_journalEntryId_idx" ON "journal_entry_accounts"("journalEntryId");

-- CreateIndex
CREATE INDEX "journal_entry_accounts_accountId_idx" ON "journal_entry_accounts"("accountId");

-- CreateIndex
CREATE INDEX "warehouses_tenantId_parentId_idx" ON "warehouses"("tenantId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenantId_warehouseName_key" ON "warehouses"("tenantId", "warehouseName");

-- CreateIndex
CREATE INDEX "bins_tenantId_warehouseId_idx" ON "bins"("tenantId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "bins_tenantId_itemId_warehouseId_key" ON "bins"("tenantId", "itemId", "warehouseId");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_tenantId_itemId_warehouseId_isCancelle_idx" ON "stock_ledger_entries"("tenantId", "itemId", "warehouseId", "isCancelled");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_tenantId_voucherType_voucherId_idx" ON "stock_ledger_entries"("tenantId", "voucherType", "voucherId");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_tenantId_postingDate_idx" ON "stock_ledger_entries"("tenantId", "postingDate");

-- CreateIndex
CREATE INDEX "stock_entries_tenantId_status_idx" ON "stock_entries"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_entries_tenantId_name_key" ON "stock_entries"("tenantId", "name");

-- CreateIndex
CREATE INDEX "stock_entry_items_stockEntryId_idx" ON "stock_entry_items"("stockEntryId");

-- CreateIndex
CREATE INDEX "gl_entries_tenantId_accountId_isCancelled_idx" ON "gl_entries"("tenantId", "accountId", "isCancelled");

-- CreateIndex
CREATE INDEX "gl_entries_tenantId_voucherType_voucherId_idx" ON "gl_entries"("tenantId", "voucherType", "voucherId");

-- CreateIndex
CREATE INDEX "gl_entries_tenantId_postingDate_idx" ON "gl_entries"("tenantId", "postingDate");

-- CreateIndex
CREATE INDEX "bank_statements_tenantId_accountId_fromDate_idx" ON "bank_statements"("tenantId", "accountId", "fromDate");

-- CreateIndex
CREATE INDEX "bank_transactions_tenantId_statementId_idx" ON "bank_transactions"("tenantId", "statementId");

-- CreateIndex
CREATE INDEX "bank_transactions_tenantId_matchStatus_idx" ON "bank_transactions"("tenantId", "matchStatus");

-- CreateIndex
CREATE INDEX "bank_transactions_matchedGlEntryId_idx" ON "bank_transactions"("matchedGlEntryId");

-- CreateIndex
CREATE INDEX "landed_cost_vouchers_tenantId_status_idx" ON "landed_cost_vouchers"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "landed_cost_vouchers_tenantId_name_key" ON "landed_cost_vouchers"("tenantId", "name");

-- CreateIndex
CREATE INDEX "landed_cost_voucher_receipts_landedCostVoucherId_idx" ON "landed_cost_voucher_receipts"("landedCostVoucherId");

-- CreateIndex
CREATE UNIQUE INDEX "landed_cost_voucher_receipts_landedCostVoucherId_purchaseRe_key" ON "landed_cost_voucher_receipts"("landedCostVoucherId", "purchaseReceiptId");

-- CreateIndex
CREATE INDEX "landed_cost_voucher_taxes_landedCostVoucherId_idx" ON "landed_cost_voucher_taxes"("landedCostVoucherId");

-- CreateIndex
CREATE INDEX "delivery_notes_tenantId_status_idx" ON "delivery_notes"("tenantId", "status");

-- CreateIndex
CREATE INDEX "delivery_notes_tenantId_customerId_idx" ON "delivery_notes"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_notes_tenantId_name_key" ON "delivery_notes"("tenantId", "name");

-- CreateIndex
CREATE INDEX "delivery_note_items_deliveryNoteId_idx" ON "delivery_note_items"("deliveryNoteId");

-- CreateIndex
CREATE INDEX "delivery_note_items_salesOrderItemId_idx" ON "delivery_note_items"("salesOrderItemId");

-- CreateIndex
CREATE INDEX "material_requests_tenantId_status_idx" ON "material_requests"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "material_requests_tenantId_name_key" ON "material_requests"("tenantId", "name");

-- CreateIndex
CREATE INDEX "material_request_items_materialRequestId_idx" ON "material_request_items"("materialRequestId");

-- CreateIndex
CREATE INDEX "stock_reconciliations_tenantId_status_idx" ON "stock_reconciliations"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reconciliations_tenantId_name_key" ON "stock_reconciliations"("tenantId", "name");

-- CreateIndex
CREATE INDEX "stock_reconciliation_items_stockReconciliationId_idx" ON "stock_reconciliation_items"("stockReconciliationId");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_status_idx" ON "purchase_orders"("tenantId", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_supplierId_idx" ON "purchase_orders"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenantId_name_key" ON "purchase_orders"("tenantId", "name");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchaseOrderId_idx" ON "purchase_order_items"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_order_items_materialRequestItemId_idx" ON "purchase_order_items"("materialRequestItemId");

-- CreateIndex
CREATE INDEX "purchase_order_taxes_purchaseOrderId_idx" ON "purchase_order_taxes"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_receipts_tenantId_status_idx" ON "purchase_receipts"("tenantId", "status");

-- CreateIndex
CREATE INDEX "purchase_receipts_tenantId_supplierId_idx" ON "purchase_receipts"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipts_tenantId_name_key" ON "purchase_receipts"("tenantId", "name");

-- CreateIndex
CREATE INDEX "purchase_receipt_items_purchaseReceiptId_idx" ON "purchase_receipt_items"("purchaseReceiptId");

-- CreateIndex
CREATE INDEX "purchase_receipt_items_purchaseOrderItemId_idx" ON "purchase_receipt_items"("purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "boms_tenantId_productionItemId_isActive_idx" ON "boms"("tenantId", "productionItemId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "boms_tenantId_name_key" ON "boms"("tenantId", "name");

-- CreateIndex
CREATE INDEX "bom_items_bomId_idx" ON "bom_items"("bomId");

-- CreateIndex
CREATE INDEX "work_orders_tenantId_status_idx" ON "work_orders"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_tenantId_name_key" ON "work_orders"("tenantId", "name");

-- CreateIndex
CREATE INDEX "leads_tenantId_status_idx" ON "leads"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenantId_name_key" ON "leads"("tenantId", "name");

-- CreateIndex
CREATE INDEX "crm_activities_tenantId_parentType_parentId_dueDate_idx" ON "crm_activities"("tenantId", "parentType", "parentId", "dueDate");

-- CreateIndex
CREATE INDEX "crm_activities_tenantId_ownerUserId_status_idx" ON "crm_activities"("tenantId", "ownerUserId", "status");

-- CreateIndex
CREATE INDEX "crm_activities_tenantId_type_dueDate_idx" ON "crm_activities"("tenantId", "type", "dueDate");

-- CreateIndex
CREATE INDEX "opportunities_tenantId_status_idx" ON "opportunities"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_tenantId_name_key" ON "opportunities"("tenantId", "name");

-- CreateIndex
CREATE INDEX "quotations_tenantId_status_idx" ON "quotations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "quotations_tenantId_nextFollowUpDate_idx" ON "quotations"("tenantId", "nextFollowUpDate");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_tenantId_name_key" ON "quotations"("tenantId", "name");

-- CreateIndex
CREATE INDEX "quotation_items_quotationId_idx" ON "quotation_items"("quotationId");

-- CreateIndex
CREATE INDEX "sales_orders_tenantId_status_idx" ON "sales_orders"("tenantId", "status");

-- CreateIndex
CREATE INDEX "sales_orders_tenantId_customerId_idx" ON "sales_orders"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_tenantId_name_key" ON "sales_orders"("tenantId", "name");

-- CreateIndex
CREATE INDEX "sales_order_items_salesOrderId_idx" ON "sales_order_items"("salesOrderId");

-- CreateIndex
CREATE INDEX "employees_tenantId_status_idx" ON "employees"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenantId_employeeCode_key" ON "employees"("tenantId", "employeeCode");

-- CreateIndex
CREATE INDEX "attendances_tenantId_date_idx" ON "attendances"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_tenantId_employeeId_date_key" ON "attendances"("tenantId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "leave_encashments_tenantId_employeeId_idx" ON "leave_encashments"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_encashments_tenantId_name_key" ON "leave_encashments"("tenantId", "name");

-- CreateIndex
CREATE INDEX "employee_skills_tenantId_skillName_idx" ON "employee_skills"("tenantId", "skillName");

-- CreateIndex
CREATE UNIQUE INDEX "employee_skills_tenantId_employeeId_skillName_key" ON "employee_skills"("tenantId", "employeeId", "skillName");

-- CreateIndex
CREATE INDEX "employee_certifications_tenantId_employeeId_idx" ON "employee_certifications"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "employee_certifications_tenantId_expiryDate_idx" ON "employee_certifications"("tenantId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "employee_grades_tenantId_name_key" ON "employee_grades"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "employment_types_tenantId_name_key" ON "employment_types"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenantId_name_key" ON "branches"("tenantId", "name");

-- CreateIndex
CREATE INDEX "training_events_tenantId_status_idx" ON "training_events"("tenantId", "status");

-- CreateIndex
CREATE INDEX "training_events_tenantId_startAt_idx" ON "training_events"("tenantId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "training_events_tenantId_name_key" ON "training_events"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "training_attendees_trainingEventId_employeeId_key" ON "training_attendees"("trainingEventId", "employeeId");

-- CreateIndex
CREATE INDEX "job_openings_tenantId_status_idx" ON "job_openings"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "job_openings_tenantId_name_key" ON "job_openings"("tenantId", "name");

-- CreateIndex
CREATE INDEX "job_applicants_tenantId_status_idx" ON "job_applicants"("tenantId", "status");

-- CreateIndex
CREATE INDEX "job_applicants_tenantId_jobOpeningId_idx" ON "job_applicants"("tenantId", "jobOpeningId");

-- CreateIndex
CREATE UNIQUE INDEX "job_applicants_tenantId_name_key" ON "job_applicants"("tenantId", "name");

-- CreateIndex
CREATE INDEX "statutory_components_tenantId_enabled_idx" ON "statutory_components"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "statutory_components_tenantId_name_key" ON "statutory_components"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "leave_policies_tenantId_name_key" ON "leave_policies"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "leave_policy_details_leavePolicyId_leaveTypeId_key" ON "leave_policy_details"("leavePolicyId", "leaveTypeId");

-- CreateIndex
CREATE INDEX "overtime_requests_tenantId_employeeId_otDate_idx" ON "overtime_requests"("tenantId", "employeeId", "otDate");

-- CreateIndex
CREATE UNIQUE INDEX "overtime_requests_tenantId_name_key" ON "overtime_requests"("tenantId", "name");

-- CreateIndex
CREATE INDEX "attendance_regularizations_tenantId_employeeId_attendanceDa_idx" ON "attendance_regularizations"("tenantId", "employeeId", "attendanceDate");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_regularizations_tenantId_name_key" ON "attendance_regularizations"("tenantId", "name");

-- CreateIndex
CREATE INDEX "employee_checkins_tenantId_employeeId_ts_idx" ON "employee_checkins"("tenantId", "employeeId", "ts");

-- CreateIndex
CREATE INDEX "employee_checkins_tenantId_ts_idx" ON "employee_checkins"("tenantId", "ts");

-- CreateIndex
CREATE INDEX "salary_slips_tenantId_status_idx" ON "salary_slips"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "salary_slips_tenantId_name_key" ON "salary_slips"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "salary_slips_tenantId_employeeId_startDate_endDate_key" ON "salary_slips"("tenantId", "employeeId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "salary_slip_components_salarySlipId_idx" ON "salary_slip_components"("salarySlipId");

-- CreateIndex
CREATE UNIQUE INDEX "currencies_tenantId_code_key" ON "currencies"("tenantId", "code");

-- CreateIndex
CREATE INDEX "exchange_rates_tenantId_fromCurrency_toCurrency_effectiveDa_idx" ON "exchange_rates"("tenantId", "fromCurrency", "toCurrency", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_tenantId_fromCurrency_toCurrency_effectiveDa_key" ON "exchange_rates"("tenantId", "fromCurrency", "toCurrency", "effectiveDate");

-- CreateIndex
CREATE INDEX "production_plans_tenantId_status_idx" ON "production_plans"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "production_plans_tenantId_name_key" ON "production_plans"("tenantId", "name");

-- CreateIndex
CREATE INDEX "production_plan_items_productionPlanId_idx" ON "production_plan_items"("productionPlanId");

-- CreateIndex
CREATE INDEX "production_plan_raw_materials_productionPlanId_idx" ON "production_plan_raw_materials"("productionPlanId");

-- CreateIndex
CREATE INDEX "item_reorder_rules_tenantId_enabled_idx" ON "item_reorder_rules"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "item_reorder_rules_tenantId_itemId_warehouseId_key" ON "item_reorder_rules"("tenantId", "itemId", "warehouseId");

-- CreateIndex
CREATE INDEX "serial_numbers_tenantId_itemId_idx" ON "serial_numbers"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "serial_numbers_tenantId_warehouseId_status_idx" ON "serial_numbers"("tenantId", "warehouseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "serial_numbers_tenantId_serialNo_key" ON "serial_numbers"("tenantId", "serialNo");

-- CreateIndex
CREATE INDEX "batches_tenantId_itemId_idx" ON "batches"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "batches_tenantId_expiryDate_idx" ON "batches"("tenantId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "batches_tenantId_itemId_batchNo_key" ON "batches"("tenantId", "itemId", "batchNo");

-- CreateIndex
CREATE INDEX "item_uom_conversions_tenantId_itemId_idx" ON "item_uom_conversions"("tenantId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "item_uom_conversions_tenantId_itemId_uom_key" ON "item_uom_conversions"("tenantId", "itemId", "uom");

-- CreateIndex
CREATE INDEX "quality_inspection_templates_tenantId_idx" ON "quality_inspection_templates"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspection_templates_tenantId_name_key" ON "quality_inspection_templates"("tenantId", "name");

-- CreateIndex
CREATE INDEX "quality_inspection_template_items_templateId_idx" ON "quality_inspection_template_items"("templateId");

-- CreateIndex
CREATE INDEX "quality_inspections_tenantId_itemId_idx" ON "quality_inspections"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "quality_inspections_tenantId_purchaseReceiptItemId_idx" ON "quality_inspections"("tenantId", "purchaseReceiptItemId");

-- CreateIndex
CREATE INDEX "quality_inspections_tenantId_deliveryNoteItemId_idx" ON "quality_inspections"("tenantId", "deliveryNoteItemId");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspections_tenantId_name_key" ON "quality_inspections"("tenantId", "name");

-- CreateIndex
CREATE INDEX "quality_inspection_readings_inspectionId_idx" ON "quality_inspection_readings"("inspectionId");

-- CreateIndex
CREATE INDEX "price_lists_tenantId_buyingOrSelling_enabled_idx" ON "price_lists"("tenantId", "buyingOrSelling", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_tenantId_name_key" ON "price_lists"("tenantId", "name");

-- CreateIndex
CREATE INDEX "item_prices_tenantId_itemId_priceListId_idx" ON "item_prices"("tenantId", "itemId", "priceListId");

-- CreateIndex
CREATE INDEX "item_prices_tenantId_priceListId_idx" ON "item_prices"("tenantId", "priceListId");

-- CreateIndex
CREATE INDEX "tax_templates_tenantId_templateType_idx" ON "tax_templates"("tenantId", "templateType");

-- CreateIndex
CREATE UNIQUE INDEX "tax_templates_tenantId_name_key" ON "tax_templates"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_clients_clientId_key" ON "oauth_clients"("clientId");

-- CreateIndex
CREATE INDEX "oauth_clients_tenantId_idx" ON "oauth_clients"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_auth_codes_codeHash_key" ON "oauth_auth_codes"("codeHash");

-- CreateIndex
CREATE INDEX "oauth_auth_codes_expiresAt_idx" ON "oauth_auth_codes"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_access_tokens_tokenHash_key" ON "oauth_access_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "oauth_access_tokens_tokenHash_idx" ON "oauth_access_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "oauth_access_tokens_userId_idx" ON "oauth_access_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_refresh_tokens_tokenHash_key" ON "oauth_refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "oauth_refresh_tokens_tokenHash_idx" ON "oauth_refresh_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_consents_clientId_userId_key" ON "oauth_consents"("clientId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_tokenHash_idx" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_tenantId_userId_idx" ON "api_tokens"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_doctype_docId_idx" ON "audit_logs"("tenantId", "doctype", "docId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_userId_createdAt_idx" ON "audit_logs"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "naming_series_counters_tenantId_idx" ON "naming_series_counters"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "naming_series_counters_tenantId_prefix_key" ON "naming_series_counters"("tenantId", "prefix");

-- CreateIndex
CREATE INDEX "tax_template_rows_taxTemplateId_idx" ON "tax_template_rows"("taxTemplateId");

-- CreateIndex
CREATE INDEX "sales_invoice_taxes_salesInvoiceId_idx" ON "sales_invoice_taxes"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "purchase_invoice_taxes_purchaseInvoiceId_idx" ON "purchase_invoice_taxes"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "quotation_taxes_quotationId_idx" ON "quotation_taxes"("quotationId");

-- CreateIndex
CREATE INDEX "sales_order_taxes_salesOrderId_idx" ON "sales_order_taxes"("salesOrderId");

-- CreateIndex
CREATE INDEX "fiscal_years_tenantId_startDate_endDate_idx" ON "fiscal_years"("tenantId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_tenantId_name_key" ON "fiscal_years"("tenantId", "name");

-- CreateIndex
CREATE INDEX "budgets_tenantId_fiscalYearId_idx" ON "budgets"("tenantId", "fiscalYearId");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_fiscalYearId_accountId_key" ON "budgets"("fiscalYearId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_tenantId_leaveTypeName_key" ON "leave_types"("tenantId", "leaveTypeName");

-- CreateIndex
CREATE INDEX "leave_allocations_tenantId_employeeId_leaveTypeId_idx" ON "leave_allocations"("tenantId", "employeeId", "leaveTypeId");

-- CreateIndex
CREATE INDEX "leave_allocations_tenantId_fromDate_toDate_idx" ON "leave_allocations"("tenantId", "fromDate", "toDate");

-- CreateIndex
CREATE INDEX "leave_applications_tenantId_employeeId_status_idx" ON "leave_applications"("tenantId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "leave_applications_tenantId_fromDate_toDate_idx" ON "leave_applications"("tenantId", "fromDate", "toDate");

-- CreateIndex
CREATE UNIQUE INDEX "appraisal_templates_tenantId_name_key" ON "appraisal_templates"("tenantId", "name");

-- CreateIndex
CREATE INDEX "appraisal_template_goals_templateId_idx" ON "appraisal_template_goals"("templateId");

-- CreateIndex
CREATE INDEX "appraisals_tenantId_status_idx" ON "appraisals"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "appraisals_tenantId_name_key" ON "appraisals"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "appraisals_tenantId_employeeId_periodStart_periodEnd_key" ON "appraisals"("tenantId", "employeeId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "appraisal_goals_appraisalId_idx" ON "appraisal_goals"("appraisalId");

-- CreateIndex
CREATE INDEX "employee_advances_tenantId_status_idx" ON "employee_advances"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_advances_tenantId_name_key" ON "employee_advances"("tenantId", "name");

-- CreateIndex
CREATE INDEX "employee_checklist_templates_tenantId_type_idx" ON "employee_checklist_templates"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "employee_checklist_templates_tenantId_name_key" ON "employee_checklist_templates"("tenantId", "name");

-- CreateIndex
CREATE INDEX "employee_checklist_template_items_templateId_idx" ON "employee_checklist_template_items"("templateId");

-- CreateIndex
CREATE INDEX "employee_checklists_tenantId_status_idx" ON "employee_checklists"("tenantId", "status");

-- CreateIndex
CREATE INDEX "employee_checklists_tenantId_type_employeeId_idx" ON "employee_checklists"("tenantId", "type", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_checklists_tenantId_name_key" ON "employee_checklists"("tenantId", "name");

-- CreateIndex
CREATE INDEX "employee_checklist_activities_checklistId_idx" ON "employee_checklist_activities"("checklistId");

-- CreateIndex
CREATE INDEX "payroll_entries_tenantId_status_idx" ON "payroll_entries"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_entries_tenantId_name_key" ON "payroll_entries"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_entry_employees_payrollEntryId_employeeId_key" ON "payroll_entry_employees"("payrollEntryId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_lists_tenantId_name_key" ON "holiday_lists"("tenantId", "name");

-- CreateIndex
CREATE INDEX "holidays_holidayListId_holidayDate_idx" ON "holidays"("holidayListId", "holidayDate");

-- CreateIndex
CREATE UNIQUE INDEX "salary_structures_tenantId_name_key" ON "salary_structures"("tenantId", "name");

-- CreateIndex
CREATE INDEX "salary_structure_components_salaryStructureId_idx" ON "salary_structure_components"("salaryStructureId");

-- CreateIndex
CREATE UNIQUE INDEX "shift_types_tenantId_name_key" ON "shift_types"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_claim_types_tenantId_typeName_key" ON "expense_claim_types"("tenantId", "typeName");

-- CreateIndex
CREATE INDEX "expense_claims_tenantId_status_idx" ON "expense_claims"("tenantId", "status");

-- CreateIndex
CREATE INDEX "expense_claims_tenantId_employeeId_idx" ON "expense_claims"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_claims_tenantId_name_key" ON "expense_claims"("tenantId", "name");

-- CreateIndex
CREATE INDEX "expense_claim_items_expenseClaimId_idx" ON "expense_claim_items"("expenseClaimId");

-- CreateIndex
CREATE UNIQUE INDEX "loan_types_tenantId_loanTypeName_key" ON "loan_types"("tenantId", "loanTypeName");

-- CreateIndex
CREATE INDEX "loans_tenantId_status_idx" ON "loans"("tenantId", "status");

-- CreateIndex
CREATE INDEX "loans_tenantId_employeeId_idx" ON "loans"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "loans_tenantId_name_key" ON "loans"("tenantId", "name");

-- CreateIndex
CREATE INDEX "loan_repayment_schedules_loanId_isPaid_idx" ON "loan_repayment_schedules"("loanId", "isPaid");

-- CreateIndex
CREATE UNIQUE INDEX "loan_repayment_schedules_loanId_installmentNo_key" ON "loan_repayment_schedules"("loanId", "installmentNo");

-- CreateIndex
CREATE INDEX "projects_tenantId_status_idx" ON "projects"("tenantId", "status");

-- CreateIndex
CREATE INDEX "projects_tenantId_customerId_idx" ON "projects"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_tenantId_name_key" ON "projects"("tenantId", "name");

-- CreateIndex
CREATE INDEX "tasks_tenantId_projectId_status_idx" ON "tasks"("tenantId", "projectId", "status");

-- CreateIndex
CREATE INDEX "tasks_tenantId_assignedEmployeeId_idx" ON "tasks"("tenantId", "assignedEmployeeId");

-- CreateIndex
CREATE INDEX "tasks_projectId_parentTaskId_idx" ON "tasks"("projectId", "parentTaskId");

-- CreateIndex
CREATE INDEX "tasks_projectId_milestoneId_idx" ON "tasks"("projectId", "milestoneId");

-- CreateIndex
CREATE INDEX "milestones_tenantId_projectId_order_idx" ON "milestones"("tenantId", "projectId", "order");

-- CreateIndex
CREATE INDEX "task_dependencies_toTaskId_idx" ON "task_dependencies"("toTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_fromTaskId_toTaskId_key" ON "task_dependencies"("fromTaskId", "toTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "project_templates_tenantId_name_key" ON "project_templates"("tenantId", "name");

-- CreateIndex
CREATE INDEX "agile_workspaces_tenantId_isActive_idx" ON "agile_workspaces"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "agile_workspaces_tenantId_key_key" ON "agile_workspaces"("tenantId", "key");

-- CreateIndex
CREATE INDEX "sprints_workspaceId_status_idx" ON "sprints"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "epics_workspaceId_status_idx" ON "epics"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "releases_workspaceId_status_idx" ON "releases"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "work_items_workspaceId_sprintId_status_idx" ON "work_items"("workspaceId", "sprintId", "status");

-- CreateIndex
CREATE INDEX "work_items_workspaceId_epicId_idx" ON "work_items"("workspaceId", "epicId");

-- CreateIndex
CREATE INDEX "work_items_workspaceId_parentWorkItemId_idx" ON "work_items"("workspaceId", "parentWorkItemId");

-- CreateIndex
CREATE UNIQUE INDEX "work_items_workspaceId_key_key" ON "work_items"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "okrs_workspaceId_period_status_idx" ON "okrs"("workspaceId", "period", "status");

-- CreateIndex
CREATE INDEX "key_results_okrId_idx" ON "key_results"("okrId");

-- CreateIndex
CREATE INDEX "timesheets_tenantId_employeeId_weekStartDate_idx" ON "timesheets"("tenantId", "employeeId", "weekStartDate");

-- CreateIndex
CREATE INDEX "timesheets_tenantId_status_idx" ON "timesheets"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "timesheets_tenantId_name_key" ON "timesheets"("tenantId", "name");

-- CreateIndex
CREATE INDEX "timesheet_lines_timesheetId_idx" ON "timesheet_lines"("timesheetId");

-- CreateIndex
CREATE INDEX "timesheet_lines_projectId_idx" ON "timesheet_lines"("projectId");

-- CreateIndex
CREATE INDEX "timesheet_lines_taskId_idx" ON "timesheet_lines"("taskId");

-- CreateIndex
CREATE INDEX "timesheet_lines_salesInvoiceItemId_idx" ON "timesheet_lines"("salesInvoiceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_tenantId_categoryName_key" ON "asset_categories"("tenantId", "categoryName");

-- CreateIndex
CREATE INDEX "assets_tenantId_status_idx" ON "assets"("tenantId", "status");

-- CreateIndex
CREATE INDEX "assets_tenantId_categoryId_idx" ON "assets"("tenantId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "assets_tenantId_assetCode_key" ON "assets"("tenantId", "assetCode");

-- CreateIndex
CREATE INDEX "asset_depreciation_schedules_assetId_isBooked_idx" ON "asset_depreciation_schedules"("assetId", "isBooked");

-- CreateIndex
CREATE UNIQUE INDEX "asset_depreciation_schedules_assetId_installmentNo_key" ON "asset_depreciation_schedules"("assetId", "installmentNo");

-- CreateIndex
CREATE INDEX "asset_maintenance_logs_assetId_date_idx" ON "asset_maintenance_logs"("assetId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "workstations_tenantId_name_key" ON "workstations"("tenantId", "name");

-- CreateIndex
CREATE INDEX "bom_operations_bomId_idx" ON "bom_operations"("bomId");

-- CreateIndex
CREATE INDEX "work_order_operations_workOrderId_idx" ON "work_order_operations"("workOrderId");

-- CreateIndex
CREATE INDEX "job_cards_tenantId_workOrderId_status_idx" ON "job_cards"("tenantId", "workOrderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "job_cards_tenantId_name_key" ON "job_cards"("tenantId", "name");

-- CreateIndex
CREATE INDEX "job_card_time_logs_jobCardId_idx" ON "job_card_time_logs"("jobCardId");

-- CreateIndex
CREATE INDEX "custom_fields_tenantId_doctype_idx" ON "custom_fields"("tenantId", "doctype");

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_tenantId_doctype_fieldName_key" ON "custom_fields"("tenantId", "doctype", "fieldName");

-- CreateIndex
CREATE INDEX "data_subject_requests_tenantId_status_idx" ON "data_subject_requests"("tenantId", "status");

-- CreateIndex
CREATE INDEX "data_subject_requests_tenantId_subjectType_subjectId_idx" ON "data_subject_requests"("tenantId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "data_subject_requests_tenantId_name_key" ON "data_subject_requests"("tenantId", "name");

-- CreateIndex
CREATE INDEX "data_retention_policies_tenantId_enabled_idx" ON "data_retention_policies"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "data_retention_policies_tenantId_doctype_key" ON "data_retention_policies"("tenantId", "doctype");

-- CreateIndex
CREATE INDEX "consent_records_tenantId_portalUserId_createdAt_idx" ON "consent_records"("tenantId", "portalUserId", "createdAt");

-- CreateIndex
CREATE INDEX "anonymization_archives_tenantId_subjectType_subjectId_idx" ON "anonymization_archives"("tenantId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "anonymization_archives_tenantId_createdAt_idx" ON "anonymization_archives"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "feature_flags_tenantId_enabled_idx" ON "feature_flags"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_tenantId_key_key" ON "feature_flags"("tenantId", "key");

-- CreateIndex
CREATE INDEX "backup_jobs_tenantId_status_idx" ON "backup_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "backup_jobs_tenantId_createdAt_idx" ON "backup_jobs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "error_logs_tenantId_createdAt_idx" ON "error_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "error_logs_service_createdAt_idx" ON "error_logs"("service", "createdAt");

-- CreateIndex
CREATE INDEX "tenant_integrations_tenantId_provider_idx" ON "tenant_integrations"("tenantId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_integrations_tenantId_provider_name_key" ON "tenant_integrations"("tenantId", "provider", "name");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_tenantId_isActive_idx" ON "webhook_subscriptions"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_subscriptions_tenantId_name_key" ON "webhook_subscriptions"("tenantId", "name");

-- CreateIndex
CREATE INDEX "webhook_deliveries_tenantId_status_scheduledFor_idx" ON "webhook_deliveries"("tenantId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "webhook_deliveries_subscriptionId_createdAt_idx" ON "webhook_deliveries"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "integration_events_tenantId_provider_status_idx" ON "integration_events"("tenantId", "provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_events_tenantId_provider_externalId_key" ON "integration_events"("tenantId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "portal_users_tenantId_partyType_partyId_idx" ON "portal_users"("tenantId", "partyType", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_users_tenantId_email_key" ON "portal_users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "portal_invites_tokenHash_key" ON "portal_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "portal_invites_tenantId_portalUserId_idx" ON "portal_invites"("tenantId", "portalUserId");

-- CreateIndex
CREATE INDEX "portal_tickets_tenantId_status_idx" ON "portal_tickets"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "portal_tickets_tenantId_name_key" ON "portal_tickets"("tenantId", "name");

-- CreateIndex
CREATE INDEX "portal_ticket_replies_portalTicketId_createdAt_idx" ON "portal_ticket_replies"("portalTicketId", "createdAt");

-- CreateIndex
CREATE INDEX "import_jobs_tenantId_status_idx" ON "import_jobs"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_jobs_tenantId_name_key" ON "import_jobs"("tenantId", "name");

-- CreateIndex
CREATE INDEX "import_job_rows_importJobId_status_idx" ON "import_job_rows"("importJobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "export_presets_tenantId_doctype_name_key" ON "export_presets"("tenantId", "doctype", "name");

-- CreateIndex
CREATE INDEX "list_views_tenantId_doctype_ownerUserId_idx" ON "list_views"("tenantId", "doctype", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "list_views_tenantId_doctype_name_key" ON "list_views"("tenantId", "doctype", "name");

-- CreateIndex
CREATE INDEX "saved_reports_tenantId_doctype_idx" ON "saved_reports"("tenantId", "doctype");

-- CreateIndex
CREATE INDEX "saved_reports_tenantId_ownerUserId_idx" ON "saved_reports"("tenantId", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_reports_tenantId_name_key" ON "saved_reports"("tenantId", "name");

-- CreateIndex
CREATE INDEX "letterheads_tenantId_isDefault_idx" ON "letterheads"("tenantId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "letterheads_tenantId_name_key" ON "letterheads"("tenantId", "name");

-- CreateIndex
CREATE INDEX "print_formats_tenantId_doctype_isDefault_idx" ON "print_formats"("tenantId", "doctype", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "print_formats_tenantId_doctype_name_key" ON "print_formats"("tenantId", "doctype", "name");

-- CreateIndex
CREATE INDEX "dashboards_tenantId_ownerUserId_idx" ON "dashboards"("tenantId", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboards_tenantId_name_key" ON "dashboards"("tenantId", "name");

-- CreateIndex
CREATE INDEX "dashboard_cards_dashboardId_idx" ON "dashboard_cards"("dashboardId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_bookmarks_tenantId_userId_dashboardId_key" ON "dashboard_bookmarks"("tenantId", "userId", "dashboardId");

-- CreateIndex
CREATE UNIQUE INDEX "report_bookmarks_tenantId_userId_savedReportId_key" ON "report_bookmarks"("tenantId", "userId", "savedReportId");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_share_links_token_key" ON "analytics_share_links"("token");

-- CreateIndex
CREATE INDEX "analytics_share_links_tenantId_dashboardId_idx" ON "analytics_share_links"("tenantId", "dashboardId");

-- CreateIndex
CREATE INDEX "analytics_share_links_tenantId_isActive_idx" ON "analytics_share_links"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "scheduled_reports_tenantId_enabled_frequency_idx" ON "scheduled_reports"("tenantId", "enabled", "frequency");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_reports_tenantId_name_key" ON "scheduled_reports"("tenantId", "name");

-- CreateIndex
CREATE INDEX "learn_courses_tenantId_isPublished_idx" ON "learn_courses"("tenantId", "isPublished");

-- CreateIndex
CREATE INDEX "learn_lessons_courseId_sortOrder_idx" ON "learn_lessons"("courseId", "sortOrder");

-- CreateIndex
CREATE INDEX "learn_enrollments_tenantId_userId_idx" ON "learn_enrollments"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "learn_enrollments_tenantId_userId_courseId_key" ON "learn_enrollments"("tenantId", "userId", "courseId");

-- CreateIndex
CREATE INDEX "learn_lesson_progress_lessonId_idx" ON "learn_lesson_progress"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "learn_lesson_progress_enrollmentId_lessonId_key" ON "learn_lesson_progress"("enrollmentId", "lessonId");

-- CreateIndex
CREATE INDEX "learn_certificates_tenantId_userId_idx" ON "learn_certificates"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "learn_certificates_tenantId_certificateNumber_key" ON "learn_certificates"("tenantId", "certificateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "learn_certificates_tenantId_userId_courseId_key" ON "learn_certificates"("tenantId", "userId", "courseId");

-- CreateIndex
CREATE INDEX "notebooks_tenantId_ownerUserId_archivedAt_idx" ON "notebooks"("tenantId", "ownerUserId", "archivedAt");

-- CreateIndex
CREATE INDEX "notes_tenantId_notebookId_deletedAt_archivedAt_idx" ON "notes"("tenantId", "notebookId", "deletedAt", "archivedAt");

-- CreateIndex
CREATE INDEX "notes_tenantId_ownerUserId_pinned_deletedAt_archivedAt_idx" ON "notes"("tenantId", "ownerUserId", "pinned", "deletedAt", "archivedAt");

-- CreateIndex
CREATE INDEX "workdrive_folders_tenantId_parentId_deletedAt_idx" ON "workdrive_folders"("tenantId", "parentId", "deletedAt");

-- CreateIndex
CREATE INDEX "workdrive_files_tenantId_folderId_deletedAt_idx" ON "workdrive_files"("tenantId", "folderId", "deletedAt");

-- CreateIndex
CREATE INDEX "workdrive_files_tenantId_starred_deletedAt_idx" ON "workdrive_files"("tenantId", "starred", "deletedAt");

-- CreateIndex
CREATE INDEX "workdrive_file_versions_fileId_idx" ON "workdrive_file_versions"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "workdrive_file_versions_fileId_version_key" ON "workdrive_file_versions"("fileId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "workdrive_share_links_token_key" ON "workdrive_share_links"("token");

-- CreateIndex
CREATE INDEX "workdrive_share_links_tenantId_fileId_idx" ON "workdrive_share_links"("tenantId", "fileId");

-- CreateIndex
CREATE INDEX "workdrive_share_links_tenantId_isActive_idx" ON "workdrive_share_links"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "workdrive_comments_fileId_idx" ON "workdrive_comments"("fileId");

-- CreateIndex
CREATE INDEX "attachments_tenantId_doctype_docId_idx" ON "attachments"("tenantId", "doctype", "docId");

-- CreateIndex
CREATE INDEX "attachments_tenantId_uploadedBy_idx" ON "attachments"("tenantId", "uploadedBy");

-- CreateIndex
CREATE INDEX "comments_tenantId_doctype_docId_idx" ON "comments"("tenantId", "doctype", "docId");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_isRead_idx" ON "notifications"("tenantId", "userId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_createdAt_idx" ON "notifications"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_tenantId_name_key" ON "email_templates"("tenantId", "name");

-- CreateIndex
CREATE INDEX "email_messages_tenantId_status_scheduledFor_idx" ON "email_messages"("tenantId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "email_messages_tenantId_linkedDoctype_linkedId_idx" ON "email_messages"("tenantId", "linkedDoctype", "linkedId");

-- CreateIndex
CREATE UNIQUE INDEX "sms_templates_tenantId_name_key" ON "sms_templates"("tenantId", "name");

-- CreateIndex
CREATE INDEX "sms_messages_tenantId_status_scheduledFor_idx" ON "sms_messages"("tenantId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "doc_subscriptions_tenantId_doctype_docId_idx" ON "doc_subscriptions"("tenantId", "doctype", "docId");

-- CreateIndex
CREATE UNIQUE INDEX "doc_subscriptions_tenantId_userId_doctype_docId_key" ON "doc_subscriptions"("tenantId", "userId", "doctype", "docId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_tenantId_userId_category_channel_key" ON "notification_preferences"("tenantId", "userId", "category", "channel");

-- CreateIndex
CREATE INDEX "digest_schedules_tenantId_enabled_frequency_idx" ON "digest_schedules"("tenantId", "enabled", "frequency");

-- CreateIndex
CREATE UNIQUE INDEX "digest_schedules_tenantId_userId_frequency_key" ON "digest_schedules"("tenantId", "userId", "frequency");

-- CreateIndex
CREATE INDEX "broadcasts_tenantId_status_idx" ON "broadcasts"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "broadcasts_tenantId_name_key" ON "broadcasts"("tenantId", "name");

-- CreateIndex
CREATE INDEX "todos_tenantId_ownerUserId_isDone_idx" ON "todos"("tenantId", "ownerUserId", "isDone");

-- CreateIndex
CREATE INDEX "todos_tenantId_dueDate_idx" ON "todos"("tenantId", "dueDate");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_defaultHolidayListId_fkey" FOREIGN KEY ("defaultHolidayListId") REFERENCES "holiday_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_backup_codes" ADD CONSTRAINT "totp_backup_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_states" ADD CONSTRAINT "workflow_states_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_terms_templates" ADD CONSTRAINT "payment_terms_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_terms_template_items" ADD CONSTRAINT "payment_terms_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "payment_terms_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_listId_fkey" FOREIGN KEY ("listId") REFERENCES "contact_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_list_links" ADD CONSTRAINT "campaign_list_links_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_list_links" ADD CONSTRAINT "campaign_list_links_listId_fkey" FOREIGN KEY ("listId") REFERENCES "contact_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sequences" ADD CONSTRAINT "email_sequences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sequences" ADD CONSTRAINT "email_sequences_triggerListId_fkey" FOREIGN KEY ("triggerListId") REFERENCES "contact_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sequence_steps" ADD CONSTRAINT "email_sequence_steps_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "email_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "email_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "siq_visitors" ADD CONSTRAINT "siq_visitors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "siq_page_views" ADD CONSTRAINT "siq_page_views_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "siq_visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "siq_chat_sessions" ADD CONSTRAINT "siq_chat_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "siq_chat_sessions" ADD CONSTRAINT "siq_chat_sessions_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "siq_visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "siq_chat_messages" ADD CONSTRAINT "siq_chat_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "siq_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "siq_widget_settings" ADD CONSTRAINT "siq_widget_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk_tickets" ADD CONSTRAINT "desk_tickets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk_tickets" ADD CONSTRAINT "desk_tickets_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "desk_sla_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk_ticket_replies" ADD CONSTRAINT "desk_ticket_replies_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "desk_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk_sla_policies" ADD CONSTRAINT "desk_sla_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk_assignment_rules" ADD CONSTRAINT "desk_assignment_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk_canned_responses" ADD CONSTRAINT "desk_canned_responses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk_time_entries" ADD CONSTRAINT "desk_time_entries_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "desk_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk_csat_ratings" ADD CONSTRAINT "desk_csat_ratings_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "desk_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_forms" ADD CONSTRAINT "web_forms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_form_submissions" ADD CONSTRAINT "web_form_submissions_webFormId_fkey" FOREIGN KEY ("webFormId") REFERENCES "web_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landing_page_views" ADD CONSTRAINT "landing_page_views_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "landing_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_questions" ADD CONSTRAINT "survey_questions_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "survey_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "survey_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_results" ADD CONSTRAINT "social_post_results_postId_fkey" FOREIGN KEY ("postId") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_results" ADD CONSTRAINT "social_post_results_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_monitors" ADD CONSTRAINT "social_monitors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_mentions" ADD CONSTRAINT "social_mentions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliq_channels" ADD CONSTRAINT "cliq_channels_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliq_channel_members" ADD CONSTRAINT "cliq_channel_members_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "cliq_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliq_messages" ADD CONSTRAINT "cliq_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliq_messages" ADD CONSTRAINT "cliq_messages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "cliq_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliq_messages" ADD CONSTRAINT "cliq_messages_threadParentId_fkey" FOREIGN KEY ("threadParentId") REFERENCES "cliq_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliq_reactions" ADD CONSTRAINT "cliq_reactions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "cliq_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_persons" ADD CONSTRAINT "sales_persons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_persons" ADD CONSTRAINT "sales_persons_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_point_entries" ADD CONSTRAINT "loyalty_point_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_point_entries" ADD CONSTRAINT "loyalty_point_entries_programId_fkey" FOREIGN KEY ("programId") REFERENCES "loyalty_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_point_entries" ADD CONSTRAINT "loyalty_point_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_codes" ADD CONSTRAINT "coupon_codes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_codes" ADD CONSTRAINT "coupon_codes_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "pricing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_groups" ADD CONSTRAINT "customer_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_groups" ADD CONSTRAINT "customer_groups_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "customer_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "customer_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_loyaltyProgramId_fkey" FOREIGN KEY ("loyaltyProgramId") REFERENCES "loyalty_programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_taxWithholdingCategoryId_fkey" FOREIGN KEY ("taxWithholdingCategoryId") REFERENCES "tax_withholding_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_withholding_categories" ADD CONSTRAINT "tax_withholding_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_withholding_categories" ADD CONSTRAINT "tax_withholding_categories_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_qualityInspectionTemplateId_fkey" FOREIGN KEY ("qualityInspectionTemplateId") REFERENCES "quality_inspection_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_defaultAssetCategoryId_fkey" FOREIGN KEY ("defaultAssetCategoryId") REFERENCES "asset_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_defaultSalesTaxTemplateId_fkey" FOREIGN KEY ("defaultSalesTaxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_defaultPurchaseTaxTemplateId_fkey" FOREIGN KEY ("defaultPurchaseTaxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_returnAgainstId_fkey" FOREIGN KEY ("returnAgainstId") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_salesPersonId_fkey" FOREIGN KEY ("salesPersonId") REFERENCES "sales_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_items" ADD CONSTRAINT "recurring_invoice_items_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "recurring_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_items" ADD CONSTRAINT "recurring_invoice_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_deliveryNoteItemId_fkey" FOREIGN KEY ("deliveryNoteItemId") REFERENCES "delivery_note_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_returnAgainstId_fkey" FOREIGN KEY ("returnAgainstId") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_purchaseReceiptItemId_fkey" FOREIGN KEY ("purchaseReceiptItemId") REFERENCES "purchase_receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_entries" ADD CONSTRAINT "payment_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_entries" ADD CONSTRAINT "payment_entries_withholdingCategoryId_fkey" FOREIGN KEY ("withholdingCategoryId") REFERENCES "tax_withholding_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_entries" ADD CONSTRAINT "payment_entries_withholdingAccountId_fkey" FOREIGN KEY ("withholdingAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_entry_references" ADD CONSTRAINT "payment_entry_references_paymentEntryId_fkey" FOREIGN KEY ("paymentEntryId") REFERENCES "payment_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_accounts" ADD CONSTRAINT "journal_entry_accounts_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_accounts" ADD CONSTRAINT "journal_entry_accounts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bins" ADD CONSTRAINT "bins_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bins" ADD CONSTRAINT "bins_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bins" ADD CONSTRAINT "bins_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entry_items" ADD CONSTRAINT "stock_entry_items_stockEntryId_fkey" FOREIGN KEY ("stockEntryId") REFERENCES "stock_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entry_items" ADD CONSTRAINT "stock_entry_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entry_items" ADD CONSTRAINT "stock_entry_items_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entry_items" ADD CONSTRAINT "stock_entry_items_targetWarehouseId_fkey" FOREIGN KEY ("targetWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_entries" ADD CONSTRAINT "gl_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_entries" ADD CONSTRAINT "gl_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matchedGlEntryId_fkey" FOREIGN KEY ("matchedGlEntryId") REFERENCES "gl_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_vouchers" ADD CONSTRAINT "landed_cost_vouchers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_voucher_receipts" ADD CONSTRAINT "landed_cost_voucher_receipts_landedCostVoucherId_fkey" FOREIGN KEY ("landedCostVoucherId") REFERENCES "landed_cost_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_voucher_receipts" ADD CONSTRAINT "landed_cost_voucher_receipts_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_voucher_taxes" ADD CONSTRAINT "landed_cost_voucher_taxes_landedCostVoucherId_fkey" FOREIGN KEY ("landedCostVoucherId") REFERENCES "landed_cost_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_voucher_taxes" ADD CONSTRAINT "landed_cost_voucher_taxes_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_items" ADD CONSTRAINT "delivery_note_items_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_items" ADD CONSTRAINT "delivery_note_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_items" ADD CONSTRAINT "delivery_note_items_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_items" ADD CONSTRAINT "delivery_note_items_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_items" ADD CONSTRAINT "material_request_items_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "material_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_items" ADD CONSTRAINT "material_request_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_items" ADD CONSTRAINT "material_request_items_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reconciliations" ADD CONSTRAINT "stock_reconciliations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reconciliation_items" ADD CONSTRAINT "stock_reconciliation_items_stockReconciliationId_fkey" FOREIGN KEY ("stockReconciliationId") REFERENCES "stock_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reconciliation_items" ADD CONSTRAINT "stock_reconciliation_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reconciliation_items" ADD CONSTRAINT "stock_reconciliation_items_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierWarehouseId_fkey" FOREIGN KEY ("supplierWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_materialRequestItemId_fkey" FOREIGN KEY ("materialRequestItemId") REFERENCES "material_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_taxes" ADD CONSTRAINT "purchase_order_taxes_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_taxes" ADD CONSTRAINT "purchase_order_taxes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_taxes" ADD CONSTRAINT "purchase_order_taxes_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boms" ADD CONSTRAINT "boms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boms" ADD CONSTRAINT "boms_productionItemId_fkey" FOREIGN KEY ("productionItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "boms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_productionItemId_fkey" FOREIGN KEY ("productionItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_targetWarehouseId_fkey" FOREIGN KEY ("targetWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_convertedCustomerId_fkey" FOREIGN KEY ("convertedCustomerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "salary_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_defaultShiftId_fkey" FOREIGN KEY ("defaultShiftId") REFERENCES "shift_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_holidayListId_fkey" FOREIGN KEY ("holidayListId") REFERENCES "holiday_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_leavePolicyId_fkey" FOREIGN KEY ("leavePolicyId") REFERENCES "leave_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "employee_grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_employmentTypeId_fkey" FOREIGN KEY ("employmentTypeId") REFERENCES "employment_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shift_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_certifications" ADD CONSTRAINT "employee_certifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_certifications" ADD CONSTRAINT "employee_certifications_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_grades" ADD CONSTRAINT "employee_grades_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_types" ADD CONSTRAINT "employment_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_events" ADD CONSTRAINT "training_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_trainingEventId_fkey" FOREIGN KEY ("trainingEventId") REFERENCES "training_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applicants" ADD CONSTRAINT "job_applicants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applicants" ADD CONSTRAINT "job_applicants_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "job_openings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applicants" ADD CONSTRAINT "job_applicants_hiredEmployeeId_fkey" FOREIGN KEY ("hiredEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statutory_components" ADD CONSTRAINT "statutory_components_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_policy_details" ADD CONSTRAINT "leave_policy_details_leavePolicyId_fkey" FOREIGN KEY ("leavePolicyId") REFERENCES "leave_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_policy_details" ADD CONSTRAINT "leave_policy_details_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_regularizations" ADD CONSTRAINT "attendance_regularizations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_regularizations" ADD CONSTRAINT "attendance_regularizations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_checkins" ADD CONSTRAINT "employee_checkins_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_checkins" ADD CONSTRAINT "employee_checkins_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slip_components" ADD CONSTRAINT "salary_slip_components_salarySlipId_fkey" FOREIGN KEY ("salarySlipId") REFERENCES "salary_slips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan_items" ADD CONSTRAINT "production_plan_items_productionPlanId_fkey" FOREIGN KEY ("productionPlanId") REFERENCES "production_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan_items" ADD CONSTRAINT "production_plan_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan_items" ADD CONSTRAINT "production_plan_items_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan_raw_materials" ADD CONSTRAINT "production_plan_raw_materials_productionPlanId_fkey" FOREIGN KEY ("productionPlanId") REFERENCES "production_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan_raw_materials" ADD CONSTRAINT "production_plan_raw_materials_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_reorder_rules" ADD CONSTRAINT "item_reorder_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_reorder_rules" ADD CONSTRAINT "item_reorder_rules_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_reorder_rules" ADD CONSTRAINT "item_reorder_rules_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_purchaseReceiptItemId_fkey" FOREIGN KEY ("purchaseReceiptItemId") REFERENCES "purchase_receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_deliveryNoteItemId_fkey" FOREIGN KEY ("deliveryNoteItemId") REFERENCES "delivery_note_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_uom_conversions" ADD CONSTRAINT "item_uom_conversions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_uom_conversions" ADD CONSTRAINT "item_uom_conversions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_templates" ADD CONSTRAINT "quality_inspection_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_template_items" ADD CONSTRAINT "quality_inspection_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "quality_inspection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "quality_inspection_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_purchaseReceiptItemId_fkey" FOREIGN KEY ("purchaseReceiptItemId") REFERENCES "purchase_receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_deliveryNoteItemId_fkey" FOREIGN KEY ("deliveryNoteItemId") REFERENCES "delivery_note_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_readings" ADD CONSTRAINT "quality_inspection_readings_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_prices" ADD CONSTRAINT "item_prices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_prices" ADD CONSTRAINT "item_prices_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_prices" ADD CONSTRAINT "item_prices_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_templates" ADD CONSTRAINT "tax_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_templates" ADD CONSTRAINT "tax_templates_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_auth_codes" ADD CONSTRAINT "oauth_auth_codes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_auth_codes" ADD CONSTRAINT "oauth_auth_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_accessTokenId_fkey" FOREIGN KEY ("accessTokenId") REFERENCES "oauth_access_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_consents" ADD CONSTRAINT "oauth_consents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_consents" ADD CONSTRAINT "oauth_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "naming_series_counters" ADD CONSTRAINT "naming_series_counters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_template_rows" ADD CONSTRAINT "tax_template_rows_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_template_rows" ADD CONSTRAINT "tax_template_rows_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_taxes" ADD CONSTRAINT "sales_invoice_taxes_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_taxes" ADD CONSTRAINT "sales_invoice_taxes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_taxes" ADD CONSTRAINT "sales_invoice_taxes_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_taxes" ADD CONSTRAINT "purchase_invoice_taxes_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_taxes" ADD CONSTRAINT "purchase_invoice_taxes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_taxes" ADD CONSTRAINT "purchase_invoice_taxes_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_taxes" ADD CONSTRAINT "quotation_taxes_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_taxes" ADD CONSTRAINT "quotation_taxes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_taxes" ADD CONSTRAINT "quotation_taxes_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_taxes" ADD CONSTRAINT "sales_order_taxes_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_taxes" ADD CONSTRAINT "sales_order_taxes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_taxes" ADD CONSTRAINT "sales_order_taxes_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "tax_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_allocations" ADD CONSTRAINT "leave_allocations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_allocations" ADD CONSTRAINT "leave_allocations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_allocations" ADD CONSTRAINT "leave_allocations_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisal_templates" ADD CONSTRAINT "appraisal_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisal_template_goals" ADD CONSTRAINT "appraisal_template_goals_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "appraisal_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "appraisal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisal_goals" ADD CONSTRAINT "appraisal_goals_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "appraisals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_advanceAccountId_fkey" FOREIGN KEY ("advanceAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_checklist_templates" ADD CONSTRAINT "employee_checklist_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_checklist_template_items" ADD CONSTRAINT "employee_checklist_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "employee_checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_checklists" ADD CONSTRAINT "employee_checklists_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_checklists" ADD CONSTRAINT "employee_checklists_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_checklists" ADD CONSTRAINT "employee_checklists_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "employee_checklist_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_checklist_activities" ADD CONSTRAINT "employee_checklist_activities_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "employee_checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entry_employees" ADD CONSTRAINT "payroll_entry_employees_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "payroll_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entry_employees" ADD CONSTRAINT "payroll_entry_employees_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entry_employees" ADD CONSTRAINT "payroll_entry_employees_salarySlipId_fkey" FOREIGN KEY ("salarySlipId") REFERENCES "salary_slips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_lists" ADD CONSTRAINT "holiday_lists_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_holidayListId_fkey" FOREIGN KEY ("holidayListId") REFERENCES "holiday_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structure_components" ADD CONSTRAINT "salary_structure_components_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "salary_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_types" ADD CONSTRAINT "shift_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claim_types" ADD CONSTRAINT "expense_claim_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claim_types" ADD CONSTRAINT "expense_claim_types_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claim_items" ADD CONSTRAINT "expense_claim_items_expenseClaimId_fkey" FOREIGN KEY ("expenseClaimId") REFERENCES "expense_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claim_items" ADD CONSTRAINT "expense_claim_items_expenseClaimTypeId_fkey" FOREIGN KEY ("expenseClaimTypeId") REFERENCES "expense_claim_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claim_items" ADD CONSTRAINT "expense_claim_items_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_types" ADD CONSTRAINT "loan_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_loanTypeId_fkey" FOREIGN KEY ("loanTypeId") REFERENCES "loan_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayment_schedules" ADD CONSTRAINT "loan_repayment_schedules_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_fromTemplateId_fkey" FOREIGN KEY ("fromTemplateId") REFERENCES "project_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_fromTaskId_fkey" FOREIGN KEY ("fromTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_toTaskId_fkey" FOREIGN KEY ("toTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agile_workspaces" ADD CONSTRAINT "agile_workspaces_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "agile_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epics" ADD CONSTRAINT "epics_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "agile_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "agile_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "agile_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "epics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_parentWorkItemId_fkey" FOREIGN KEY ("parentWorkItemId") REFERENCES "work_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "okrs" ADD CONSTRAINT "okrs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "agile_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_results" ADD CONSTRAINT "key_results_okrId_fkey" FOREIGN KEY ("okrId") REFERENCES "okrs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_lines" ADD CONSTRAINT "timesheet_lines_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "timesheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_lines" ADD CONSTRAINT "timesheet_lines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_lines" ADD CONSTRAINT "timesheet_lines_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_lines" ADD CONSTRAINT "timesheet_lines_salesInvoiceItemId_fkey" FOREIGN KEY ("salesInvoiceItemId") REFERENCES "sales_invoice_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_assetAccountId_fkey" FOREIGN KEY ("assetAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_accumDepreciationAccountId_fkey" FOREIGN KEY ("accumDepreciationAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_depExpenseAccountId_fkey" FOREIGN KEY ("depExpenseAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_sourcePurchaseInvoiceItemId_fkey" FOREIGN KEY ("sourcePurchaseInvoiceItemId") REFERENCES "purchase_invoice_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_depreciation_schedules" ADD CONSTRAINT "asset_depreciation_schedules_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_maintenance_logs" ADD CONSTRAINT "asset_maintenance_logs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_operations" ADD CONSTRAINT "bom_operations_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_operations" ADD CONSTRAINT "bom_operations_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "workstations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_operations" ADD CONSTRAINT "work_order_operations_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_operations" ADD CONSTRAINT "work_order_operations_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "workstations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "work_order_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "workstations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_card_time_logs" ADD CONSTRAINT "job_card_time_logs_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "job_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_retention_policies" ADD CONSTRAINT "data_retention_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anonymization_archives" ADD CONSTRAINT "anonymization_archives_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_integrations" ADD CONSTRAINT "tenant_integrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "tenant_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "tenant_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invites" ADD CONSTRAINT "portal_invites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invites" ADD CONSTRAINT "portal_invites_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_tickets" ADD CONSTRAINT "portal_tickets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_tickets" ADD CONSTRAINT "portal_tickets_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_ticket_replies" ADD CONSTRAINT "portal_ticket_replies_portalTicketId_fkey" FOREIGN KEY ("portalTicketId") REFERENCES "portal_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_presets" ADD CONSTRAINT "export_presets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_views" ADD CONSTRAINT "list_views_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letterheads" ADD CONSTRAINT "letterheads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_formats" ADD CONSTRAINT "print_formats_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_cards" ADD CONSTRAINT "dashboard_cards_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_bookmarks" ADD CONSTRAINT "dashboard_bookmarks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_bookmarks" ADD CONSTRAINT "dashboard_bookmarks_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_bookmarks" ADD CONSTRAINT "report_bookmarks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_bookmarks" ADD CONSTRAINT "report_bookmarks_savedReportId_fkey" FOREIGN KEY ("savedReportId") REFERENCES "saved_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_share_links" ADD CONSTRAINT "analytics_share_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_share_links" ADD CONSTRAINT "analytics_share_links_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_savedReportId_fkey" FOREIGN KEY ("savedReportId") REFERENCES "saved_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learn_courses" ADD CONSTRAINT "learn_courses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learn_lessons" ADD CONSTRAINT "learn_lessons_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "learn_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learn_enrollments" ADD CONSTRAINT "learn_enrollments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learn_enrollments" ADD CONSTRAINT "learn_enrollments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "learn_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learn_lesson_progress" ADD CONSTRAINT "learn_lesson_progress_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "learn_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learn_lesson_progress" ADD CONSTRAINT "learn_lesson_progress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "learn_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learn_certificates" ADD CONSTRAINT "learn_certificates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learn_certificates" ADD CONSTRAINT "learn_certificates_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "learn_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notebooks" ADD CONSTRAINT "notebooks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "notebooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workdrive_folders" ADD CONSTRAINT "workdrive_folders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workdrive_folders" ADD CONSTRAINT "workdrive_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "workdrive_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workdrive_files" ADD CONSTRAINT "workdrive_files_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workdrive_files" ADD CONSTRAINT "workdrive_files_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "workdrive_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workdrive_file_versions" ADD CONSTRAINT "workdrive_file_versions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "workdrive_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workdrive_share_links" ADD CONSTRAINT "workdrive_share_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workdrive_share_links" ADD CONSTRAINT "workdrive_share_links_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "workdrive_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workdrive_comments" ADD CONSTRAINT "workdrive_comments_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "workdrive_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "email_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "sms_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_subscriptions" ADD CONSTRAINT "doc_subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digest_schedules" ADD CONSTRAINT "digest_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

