export class PayloadBuilder {
  static build(platform: string, transaction: any, lineItems: any[], references: any, teamSettings: any) {
    const type = transaction.type; // expense or sale
    const defaultExpenseType = teamSettings.defaultExpenseType || "expense"; // expense, purchase, journalentry
    const defaultSalesType = teamSettings.defaultSalesType || "invoice"; // invoice, salesreceipt, journalentry

    switch (platform.toLowerCase()) {
      case "quickbooks":
        if (type === "expense") {
          if (defaultExpenseType === "journalentry") return this.buildQuickBooksJournal(transaction, lineItems, references);
          return this.buildQuickBooksPurchase(transaction, lineItems, references);
        } else {
          if (defaultSalesType === "salesreceipt") return this.buildQuickBooksSalesReceipt(transaction, lineItems, references);
          if (defaultSalesType === "journalentry") return this.buildQuickBooksJournal(transaction, lineItems, references);
          return this.buildQuickBooksInvoice(transaction, lineItems, references);
        }
      case "xero":
        if (type === "expense") {
          if (defaultExpenseType === "journalentry") return this.buildXeroJournal(transaction, lineItems, references);
          return this.buildXeroInvoice(transaction, lineItems, references, "ACCPAY");
        } else {
          if (defaultSalesType === "journalentry") return this.buildXeroJournal(transaction, lineItems, references);
          return this.buildXeroInvoice(transaction, lineItems, references, "ACCREC");
        }
      case "zoho":
      case "zohobooks":
        if (type === "expense") {
          if (defaultExpenseType === "journalentry") return this.buildZohoJournal(transaction, lineItems, references);
          return this.buildZohoExpense(transaction, lineItems, references);
        } else {
          if (defaultSalesType === "journalentry") return this.buildZohoJournal(transaction, lineItems, references);
          return this.buildZohoInvoice(transaction, lineItems, references);
        }
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  private static buildQuickBooksPurchase(transaction: any, lineItems: any[], references: any) {
    return {
      PaymentType: "Cash",
      Line: this.getQBLineItems(lineItems, references, "AccountBasedExpenseLineDetail"),
      VendorRef: { value: references.contactId },
      AccountRef: { value: references.bankAccountId },
      TxnDate: transaction.date.toISOString().split("T")[0],
      PrivateNote: transaction.notes,
    };
  }

  private static buildQuickBooksInvoice(transaction: any, lineItems: any[], references: any) {
    return {
      Line: this.getQBLineItems(lineItems, references, "SalesItemLineDetail"),
      CustomerRef: { value: references.contactId },
      TxnDate: transaction.date.toISOString().split("T")[0],
      PrivateNote: transaction.notes,
    };
  }

  private static buildQuickBooksSalesReceipt(transaction: any, lineItems: any[], references: any) {
    return {
      Line: this.getQBLineItems(lineItems, references, "SalesItemLineDetail"),
      CustomerRef: { value: references.contactId },
      DepositToAccountRef: { value: references.bankAccountId },
      TxnDate: transaction.date.toISOString().split("T")[0],
    };
  }

  private static buildQuickBooksJournal(transaction: any, lineItems: any[], references: any) {
    const lines = [];
    // Debit Expense
    lines.push({
      Description: transaction.payee,
      Amount: transaction.amount / 100,
      DetailType: "JournalEntryLineDetail",
      JournalEntryLineDetail: {
        PostingType: "Debit",
        AccountRef: { value: references.accountId },
      },
    });
    // Credit Bank
    lines.push({
      Description: transaction.payee,
      Amount: transaction.amount / 100,
      DetailType: "JournalEntryLineDetail",
      JournalEntryLineDetail: {
        PostingType: "Credit",
        AccountRef: { value: references.bankAccountId },
      },
    });
    return { Line: lines };
  }

  private static getQBLineItems(lineItems: any[], references: any, detailType: string) {
    return lineItems.map((item) => {
      const line: any = {
        Description: item.productName,
        Amount: item.totalAmount / 100,
        DetailType: detailType,
      };

      if (detailType === "AccountBasedExpenseLineDetail") {
        line[detailType] = {
          AccountRef: { value: item.lineAccountId || references.accountId },
        };
      } else if (detailType === "SalesItemLineDetail" || detailType === "ItemBasedExpenseLineDetail") {
        line[detailType] = {
          ItemRef: { value: item.lineAccountId || references.accountId },
          Qty: item.quantity,
          UnitPrice: item.price / 100,
        };
      }

      return line;
    });
  }

  private static buildXeroInvoice(transaction: any, lineItems: any[], references: any, type: string) {
    return {
      Type: type,
      Contact: { ContactID: references.contactId },
      Date: transaction.date.toISOString().split("T")[0],
      LineItems: lineItems.map((item) => ({
        Description: item.productName,
        Quantity: item.quantity,
        UnitAmount: item.price / 100,
        AccountCode: item.lineAccountCode || references.accountCode,
      })),
      Status: "AUTHORISED",
    };
  }

  private static buildXeroJournal(transaction: any, lineItems: any[], references: any) {
    return {
      Date: transaction.date.toISOString().split("T")[0],
      Status: "POSTED",
      JournalLines: [
        {
          Description: transaction.payee,
          LineAmount: transaction.amount / 100,
          AccountCode: references.accountCode,
        },
        {
          Description: transaction.payee,
          LineAmount: -(transaction.amount / 100),
          AccountCode: references.bankAccountCode,
        },
      ],
    };
  }

  private static buildZohoExpense(transaction: any, lineItems: any[], references: any) {
    return {
      vendor_id: references.contactId,
      date: transaction.date.toISOString().split("T")[0],
      amount: transaction.amount / 100,
      account_id: references.accountId,
      description: transaction.notes,
    };
  }

  private static buildZohoInvoice(transaction: any, lineItems: any[], references: any) {
    return {
      customer_id: references.contactId,
      date: transaction.date.toISOString().split("T")[0],
      line_items: lineItems.map((item) => ({
        account_id: item.lineAccountId || references.accountId,
        name: item.productName,
        rate: item.price / 100,
        quantity: item.quantity,
      })),
    };
  }

  private static buildZohoJournal(transaction: any, lineItems: any[], references: any) {
    return {
      journal_date: transaction.date.toISOString().split("T")[0],
      journal_items: [
        {
          account_id: references.accountId,
          debit: transaction.amount / 100,
        },
        {
          account_id: references.bankAccountId,
          credit: transaction.amount / 100,
        },
      ],
    };
  }
}
