import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  uuid,
  jsonb,
  numeric,
  boolean,
} from "drizzle-orm/pg-core";

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  onboardingCompleted: text('onboarding_completed').default('').notNull(),
  token: varchar('token', { length: 255 }),
  resetPasswordToken: varchar('reset_password_token', { length: 255 }),
  resetPasswordExpires: timestamp('reset_password_expires'),
  planId: integer('plan_id'),
  credits: integer('credits').default(50),
  workspaceLimit: integer("workspace_limit").notNull().default(1),
  userLimit: integer("user_limit").notNull().default(1),
  status: integer('status').notNull().default(1),
  currentOrganizationId: integer('current_organization_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  ownerId: integer('owner_id').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripeProductId: text('stripe_product_id'),
  planName: varchar('plan_name', { length: 50 }),
  subscriptionStatus: varchar('subscription_status', { length: 20 }),
  settings: jsonb('settings').default({}),
  logoUrl: text('logo_url'),
  address: text('address'),
  phoneNumber: varchar('phone_number', { length: 20 }),
  email: varchar('email', { length: 255 }),
  taxId: varchar('tax_id', { length: 50 }),
  website: varchar('website', { length: 255 }),
  dateFormat: varchar('date_format', { length: 50 }).default('MM/DD/YYYY'),
  currency: varchar('currency', { length: 10 }).default('USD'),
  discountType: varchar('discount_type', { length: 20 }).default('percentage'), // percentage | flat
  paymentInstructions: text('payment_instructions'),
  defaultNotes: text('default_notes'),
  defaultTerms: text('default_terms'),
  invoiceConfig: jsonb('invoice_config').default({
    showLogo: true,
    showInvoiceMeta: true,
    showSupplier: true,
    showCustomer: true,
    showVatColumn: true,
    showPaymentDetails: true,
    showNotes: true,
    footer: {
      enabled: true,
      email: true,
      phone: true
    }
  }),
});

export const SyncJobs = pgTable("sync_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => teams.id),
  documentType: varchar("document_type", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("queued"), // queued | processing | completed | failed | cancelled
  payload: jsonb("payload").notNull(),
  result: jsonb("result"),
  totalCount: integer("total_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  nextRunAt: timestamp("next_run_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  progress: integer("progress").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
});

export const SyncJobItems = pgTable("sync_job_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => SyncJobs.id, { onDelete: "cascade" }),
  externalId: text("external_id"), // ID from the accounting platform
  referenceId: text("reference_id").notNull(), // transactionId
  status: varchar("status", { length: 20 })
    .notNull()
    .default("queued"), // queued | processing | completed | failed
  payload: jsonb("payload"),
  result: jsonb("result"),
  error: varchar("error", { length: 1000 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const Integrations = pgTable('integrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: integer('user_id').notNull(),
  organizationId: integer('organization_id').references(() => teams.id),
  provider: varchar('provider').notNull(), // xero, quickbooks, etc
  accountName: varchar('account_name'),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  tokenType: varchar('token_type'),
  scope: text('scope'),
  status: varchar('status', { length: 20 }), // 1 | 0 | 2 (active | inactive | error)
  priority: integer('priority').default(0), // 0 - no priority, 1 - primary
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  tenantId: text('tenant_id'),          // Xero
  realmId: text('realm_id'),             // QuickBooks
  orgId: text('org_id'),                 // Zoho / FreshBooks
  businessId: text('business_id'),       // Wave / Sage
  companyFileId: text('company_file_id'),// MYOB
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const categories = pgTable('budgets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  plaidId: text("plaid_id"),
  organizationId: integer('organization_id').references(() => teams.id),
  name: varchar('name').notNull(),
  amount: varchar('amount').notNull(),
  icon: varchar('icon'),
  currency: varchar('currency', { length: 10 }).default('USD').notNull(),
  createdBy: varchar('created_by').notNull(),
  visible: boolean("visible").default(true).notNull(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").references(() => teams.id),
  plaidId: text("plaid_id"),
  name: text("name").notNull(),
  externalId: text('external_id'),
  type: text('type'),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const paymentMethods = pgTable("payment_methods", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  organizationId: integer("organization_id").references(() => teams.id),
  type: varchar("type", { length: 50 }).notNull(), // card | bank_account | paypal | etc
  provider: varchar("provider", { length: 50 }), // stripe | paypal | etc
  name: text("name").notNull(),
  externalId: text('external_id'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  organizationId: integer("organization_id").references(() => teams.id),
  name: text("name").notNull(),
  externalId: text('external_id'),
  type: varchar("type", { length: 50 }), // customer | vendor | other
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 20 }),
  address: text("address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  externalId: text("external_id"), // accounting platform id
  userId: text("user_id").notNull(),
  transactionId: text("transaction_id").notNull(),
  organizationId: integer("organization_id")
    .references(() => teams.id),
  amount: numeric("amount").notNull(),
  payee: text("payee").notNull(),
  type: varchar("type", { length: 20 }).notNull(), // expense | income
  notes: text("notes"),
  date: timestamp("date", { precision: 3 }).notNull(),
  accountId: text("account_id").notNull(),
  categoryId: integer("category_id"),
  totalAmount: integer("total_amount"),
  accountingPlatform: varchar("accounting_platform", { length: 20 }),
  accountingId: text("accounting_id"),
  accountingUrl: text("accounting_url"),
  status: varchar("status", { length: 20 }).default("draft"),
  jobId: uuid("job_id").references(() => SyncJobs.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const transactionLineItems = pgTable("transaction_line_items", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  organizationId: integer("organization_id")
    .references(() => teams.id),
  jobId: uuid("job_id").references(() => SyncJobs.id),
  externalId: text("external_id"), // accounting platform id
  transactionId: text("transaction_id")
    .references(() => transactions.id, { onDelete: "cascade" })
    .notNull(),
  productName: varchar("product_name").notNull(),
  quantity: numeric("quantity").notNull(),
  price: numeric("price").notNull(),
  taxRate: numeric("tax_rate"),
  taxable: boolean("taxable").default(true).notNull(),
  discount: numeric("discount").notNull(),
  totalAmount: numeric("total_amount").notNull(),
  lineTotal: numeric("line_total").notNull(),
  lineAccountId: text("line_account_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const Inventory = pgTable('inventory', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  externalId: text('external_id'), // accounting platform id
  sku: varchar('sku', { length: 100 }),
  price: numeric('price', { precision: 10, scale: 2 }).notNull().default('0'),
  stock: integer('stock').notNull().default(0),
  userId: integer('user_id').references(() => users.id),
  organizationId: integer('organization_id').references(() => teams.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const WebhookEvents = pgTable("webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  platform: varchar("platform", { length: 20 }).notNull(),
  organizationId: integer("organization_id").notNull().references(() => teams.id),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  entityId: text("entity_id"),
  payload: jsonb("payload"),
  processed: boolean("processed").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const Receipts = pgTable("receipts", {
  id: serial("id").primaryKey(),
  syncJobId: uuid("sync_job_id")
    .notNull()
    .references(() => SyncJobs.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => teams.id),
  documentType: varchar("document_type", { length: 50 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileUrl: text("file_url"),
  category: text("category"),
  status: varchar("status", { length: 30 })
    .notNull()
    .default("parsing"), // parsing | ready | approved | failed | deleted
  rawData: jsonb("raw_data").notNull().default({}),
  buildPayload: jsonb("build_payload"),
  errorMessage: text("error_message"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
