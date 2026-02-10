import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  uuid,
  jsonb,
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
  error: text("error"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
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
