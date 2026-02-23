export interface CreateTransactionResponse {
  id: string;
  url?: string;
  accountingUrl?: string;
  lineItems?: Array<{
    id?: string;
    lineId?: string;
    description?: string;
    itemRef?: string;
    accountRef?: string;
    accountId?: string;
  }>;
  [key: string]: any;
}

export interface AccountingAdapter {
  createContact(data: any): Promise<{ id: string }>;
  createProduct(data: any): Promise<{ id: string }>;
  createInvoice?(payload: any): Promise<CreateTransactionResponse>;
  createExpense?(payload: any): Promise<CreateTransactionResponse>;
  createSalesReceipt?(payload: any): Promise<CreateTransactionResponse>;
  createPayment?(payload: any): Promise<CreateTransactionResponse>;
  createJournalEntry?(payload: any): Promise<CreateTransactionResponse>;
  createAccount(data: any): Promise<{ id: string }>;
  createTaxRate(data: any): Promise<{ id: string }>;
  refreshToken(): Promise<void>;
  
  // Reference Data Fetching
  fetchAccounts(): Promise<any[]>;
  fetchTaxRates(): Promise<any[]>;
  fetchContacts(type?: 'customer' | 'vendor', lastUpdated?: Date): Promise<any[]>;
  fetchProducts(lastUpdated?: Date): Promise<any[]>;
}
