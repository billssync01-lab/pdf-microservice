export interface AccountingAdapter {
  createContact(data: any): Promise<{ id: string }>;
  createProduct(data: any): Promise<{ id: string }>;
  createInvoice?(payload: any): Promise<{ id: string }>;
  createExpense?(payload: any): Promise<{ id: string }>;
  createSalesReceipt?(payload: any): Promise<{ id: string }>;
  createPayment?(payload: any): Promise<{ id: string }>;
  createJournalEntry?(payload: any): Promise<{ id: string }>;
  createAccount(data: any): Promise<{ id: string }>;
  createTaxRate(data: any): Promise<{ id: string }>;
  refreshToken(): Promise<void>;
  
  // Reference Data Fetching
  fetchAccounts(): Promise<any[]>;
  fetchTaxRates(): Promise<any[]>;
  fetchContacts(type?: 'customer' | 'vendor', lastUpdated?: Date): Promise<any[]>;
  fetchProducts(lastUpdated?: Date): Promise<any[]>;
}
