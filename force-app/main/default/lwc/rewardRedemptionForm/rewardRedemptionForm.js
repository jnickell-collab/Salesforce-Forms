import { LightningElement, track, wire } from 'lwc';
import isGuest from '@salesforce/user/isGuest';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import searchCustomers from '@salesforce/apex/SSG_CustomerSearch.searchCustomers';
import getUserInfo from '@salesforce/apex/SSG_CustomerSearch.getUserInfo';
import getRelevantOrders from '@salesforce/apex/SSG_CustomerSearch.getRelevantOrders';
import getProducts from '@salesforce/apex/SSG_CustomerSearch.getProducts';
import submitOrders from '@salesforce/apex/RedemptionOrderService.submitOrders';
import getAccountRepNumber from '@salesforce/apex/SSG_CustomerSearch.getAccountRepNumber';
import getRecentRedemptionForms from '@salesforce/apex/RedemptionOrderService.getRecentRedemptionForms';
import getSavedForms from '@salesforce/apex/RedemptionOrderService.getSavedForms';
import loadFormWithDetails from '@salesforce/apex/RedemptionOrderService.loadFormWithDetails';

export default class RewardRedemptionForm extends LightningElement {
    @track searchResults = [];
    @track selectedCustomer;
    @track loggedInRepId;
    @track repNumberFromAccount;
    @track grandTotal = 0;
    @track recentOrders = [];
    @track recentRedemptionForms = [];
    @track recentRedemptionFormsLoading = false;
    @track showSuccessModal = false;
    @track successMessage = {};
    // Form selection state
    @track selectedForm; // undefined until user selects
    @track submitting = false;
    @track savedForms = [];
    @track savedFormsLoading = false;
    @track showInfoMenu = false;
    modalCloseTimer;
    formOptions = [
        { label: 'Milbon', value: 'MILBON' }
        // future forms can be added here
    ];

    @track searchTerm = '';
    @track isSearching = false;
    searchTimeout;
    requestSeq = 0;

    // Product search and selection
    @track productSearchTerm = '';
    @track allProducts = [];
    @track displayedProducts = []; // Changed from getter to @track
    @track selectedProducts = []; // { productCode, description, unitPrice, qty, total }
    @track isLoadingProducts = false;

    @wire(getUserInfo)
    wiredUser({ error, data }) {
        if (data) {
            this.loggedInRepId = data.repId;
        } else if (error) {
            console.error('User Info Error:', error);
        }
    }

    connectedCallback() {
        // Prevent login loop: always redirect guests to the standard site login page.
        if (isGuest) {
            const currentPath = window.location.pathname;
            const loginPath = '/s/login';
            if (!currentPath.startsWith(loginPath)) {
                const startUrl = encodeURIComponent(currentPath || '/');
                window.location.replace(`${loginPath}?startURL=${startUrl}`);
            }
        }
    }

    handleKeyPress(event) {
        // Update the search term value on every key press
        this.searchTerm = event.target.value;
        // Perform search automatically when 3 or more characters are entered
        if (this.searchTerm.length >= 3) {
            this.performSearch();
        } else if (this.searchTerm.length < 2) {
            // Clear results when less than 2 characters
            this.searchResults = [];
        }
    }

    performSearch() {
        if (!this.searchTerm || this.searchTerm.length < 2) {
            this.searchResults = [];
            this.isSearching = false;
            return;
        }

        const currentSeq = ++this.requestSeq;
        this.isSearching = true;

        searchCustomers({ searchTerm: this.searchTerm })
            .then(result => {
                if (currentSeq === this.requestSeq) {
                    // Use spread to ensure the tracked array updates properly
                    this.searchResults = result ? [...result] : [];
                }
            })
            .catch(error => {
                console.error('Search error:', error);
                if (currentSeq === this.requestSeq) {
                    this.searchResults = [];
                }
            })
            .finally(() => {
                if (currentSeq === this.requestSeq) {
                    this.isSearching = false;
                }
            });
    }

    get hasResults() {
        return this.searchResults && this.searchResults.length > 0;
    }

    get showNoResults() {
        return !this.isSearching && this.searchTerm.length >= 2 && (!this.searchResults || this.searchResults.length === 0);
    }

    get showDropdown() {
        return this.isSearching || this.hasResults || this.showNoResults;
    }

    get isSearchDisabled() {
        return this.productSearchTerm.length === 0;
    }

    get noProductsFound() {
        return this.displayedProducts.length === 0;
    }

    get isMilbon() {
        return this.selectedForm === 'MILBON';
    }

    get isInsightsDisabled() {
        return !this.selectedCustomer;
    }


    async handleSelect(event) {
        const custId = event.currentTarget.dataset.id;
        const sel = this.searchResults.find(c => c.customerId === custId || c.accountId === custId);
        
        if (sel) {
            this.selectedCustomer = sel;
            this.selectedForm = undefined;
            this.clearSelectedProducts();
            this.showInfoMenu = false;
            this.savedForms = [];
            this.recentOrders = [];
            this.recentRedemptionForms = [];
            this.searchResults = []; 
            this.searchTerm = '';
            
            // Fetch relevant orders for the selected customer
            this.fetchRelevantOrders(sel.accountId);
            // Fetch recent redemption forms
            this.fetchRecentRedemptionForms(sel.customerId);

            // Fetch rep number from Account.XC_SalesRepId__c
            try {
                const repNum = await getAccountRepNumber({ accountId: sel.accountId });
                this.repNumberFromAccount = repNum;
            } catch (e) {
                this.repNumberFromAccount = null;
                // Non-blocking; surface info on submit if missing
                // console.error('Unable to fetch Account rep number', e);
            }
        }
    }

    fetchRelevantOrders(accountId) {
        getRelevantOrders({ accountId })
            .then(result => {
                // Format dates for display; displayNumber provided by Apex fallback to Name
                this.recentOrders = (result || []).map(order => ({
                    id: order.id,
                    date: this.formatDate(order.createdDate),
                    total: order.totalAmount,
                    formattedTotal: this.formatCurrency(order.totalAmount),
                    status: order.status,
                    number: order.displayNumber
                }));
            })
            .catch(error => {
                console.error('Error fetching relevant orders:', error);
                // Fallback to mock data if API call fails
                this.recentOrders = [
                    { id: 'ord1', date: '2026-01-10', total: 145.0, formattedTotal: this.formatCurrency(145.0), status: 'Completed' },
                    { id: 'ord2', date: '2025-12-15', total: 320.5, formattedTotal: this.formatCurrency(320.5), status: 'Completed' }
                ];
            });
    }

    // Fetch recent redemption forms for the selected customer
    async fetchRecentRedemptionForms(customerId) {
        if (!customerId) return;
        this.recentRedemptionFormsLoading = true;
        try {
            const forms = await getRecentRedemptionForms({ customerId });
            this.recentRedemptionForms = (forms || []).map(form => ({
                id: form.Id || form.id,
                poNumber: form.PONumber__c || 'N/A',
                orderTotal: form.OrderTotal__c || 0,
                formattedDate: this.formatDate(form.CreatedDate || form.createdDate),
                formattedTotal: this.formatCurrency(form.OrderTotal__c)
            }));
        } catch (error) {
            console.error('Error fetching recent redemption forms:', error);
            this.recentRedemptionForms = [];
        } finally {
            this.recentRedemptionFormsLoading = false;
        }
    }

    formatDate(dateString) {
        if (!dateString) return 'Unknown date';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            return dateString;
        }
    }

    formatCurrency(value) {
        if (value == null || isNaN(value)) return 'N/A';
        return `$${Number(value).toFixed(2)}`;
    }

    get modalHeading() {
        return this.successMessage.heading || 'Order Submitted Successfully';
    }

    get modalMessage() {
        return this.successMessage.message || 'Your order has been submitted successfully!';
    }

    get modalOrderTotal() {
        return this.successMessage.orderTotal != null ? `$${this.successMessage.orderTotal}` : 'N/A';
    }

    handleFormChange(event) {
        this.selectedForm = event.detail.value;
        this.savedForms = [];
        // Fetch products based on form
        if (this.selectedForm === 'MILBON') {
            this.fetchProducts('40');
        }
        // Add more forms here
    }

    fetchProducts(division) {
        this.isLoadingProducts = true;
        this.productSearchTerm = '';
        getProducts({ division })
            .then(result => {
                this.allProducts = result || [];
                this.displayedProducts = this.allProducts.map(prod => ({ ...prod, qty: 0, total: 0 }));
            })
            .catch(error => {
                console.error('Error fetching products:', error);
                this.allProducts = [];
                this.displayedProducts = [];
            })
            .finally(() => {
                this.isLoadingProducts = false;
            });
    }

    handleProductSearchChange(event) {
        this.productSearchTerm = event.target.value.toLowerCase();
        if (this.productSearchTerm.length === 0) {
            this.displayedProducts = this.allProducts.map(prod => {
                const selected = this.selectedProducts.find(s => s.productCode === prod.productCode);
                return {
                    ...prod,
                    qty: selected ? selected.qty : 0,
                    total: selected ? selected.qty * prod.unitPrice : 0
                };
            });
        } else {
            this.displayedProducts = this.allProducts.filter(prod =>
                prod.productCode.toLowerCase().includes(this.productSearchTerm) ||
                prod.description.toLowerCase().includes(this.productSearchTerm)
            ).slice(0, 40).map(prod => {
                const selected = this.selectedProducts.find(s => s.productCode === prod.productCode);
                return {
                    ...prod,
                    qty: selected ? selected.qty : 0,
                    total: selected ? selected.qty * prod.unitPrice : 0
                };
            });
        }
    }

    clearProductSearch() {
        this.productSearchTerm = '';
        this.displayedProducts = this.allProducts.map(prod => {
            const selected = this.selectedProducts.find(s => s.productCode === prod.productCode);
            return {
                ...prod,
                qty: selected ? selected.qty : 0,
                total: selected ? selected.qty * prod.unitPrice : 0
            };
        });
    }

    handleProductQtyChange(event) {
        const productCode = event.target.dataset.code;
        const newQty = parseInt(event.target.value) || 0;
        const existing = this.selectedProducts.find(p => p.productCode === productCode);
        if (existing) {
            existing.qty = newQty;
            existing.total = existing.qty * existing.unitPrice;
        } else if (newQty > 0) {
            const prod = this.allProducts.find(p => p.productCode === productCode);
            if (prod) {
                this.selectedProducts.push({
                    productCode: prod.productCode,
                    description: prod.description,
                    unitPrice: prod.unitPrice,
                    qty: newQty,
                    total: newQty * prod.unitPrice,
                    uid: this.generateLineUid(prod.productCode)
                });
            }
        }
        // Remove if qty 0
        this.selectedProducts = this.selectedProducts.filter(p => p.qty > 0);
        // Update displayed products
        this.updateDisplayedProducts();
        // Update grand total
        this.grandTotal = this.selectedProducts.reduce((sum, p) => sum + p.total, 0);
    }

    updateDisplayedProducts() {
        // Update the current displayedProducts with selected qtys
        this.displayedProducts = this.displayedProducts.map(prod => {
            const selected = this.selectedProducts.find(s => s.productCode === prod.productCode);
            return {
                ...prod,
                qty: selected ? selected.qty : 0,
                total: selected ? selected.qty * prod.unitPrice : 0
            };
        });
    }

    // Clear the current form selections
    handleClearFormClick() {
        this.clearSelectedProducts();
    }

    clearSelectedProducts() {
        this.selectedProducts = [];
        this.displayedProducts = (this.allProducts || []).map(prod => ({
            ...prod,
            qty: 0,
            total: 0
        }));
        this.grandTotal = 0;
    }

    openInfoMenu() {
        if (!this.selectedCustomer) return;
        this.showInfoMenu = true;
        if (this.selectedCustomer.customerId) {
            this.fetchRecentRedemptionForms(this.selectedCustomer.customerId);
        }
        if (this.isMilbon) {
            this.loadSavedForms();
        }
    }

    closeInfoMenu() {
        this.showInfoMenu = false;
    }

    async handleSavedFormSelection(event) {
        const headerId = event.currentTarget.dataset.id;
        await this.loadSavedFormById(headerId);
    }

    async loadSavedFormById(headerId) {
        if (!headerId) return;
        try {
            const res = await loadFormWithDetails({ headerId });
            if (!res || !res.success) {
                throw new Error(res && res.message ? res.message : 'Unable to load saved form.');
            }
            if (this.isMilbon && (!this.allProducts || this.allProducts.length === 0)) {
                await this.fetchProducts('40');
            }

            const prodMap = {};
            (this.allProducts || []).forEach(p => { prodMap[p.productCode] = p; });

            const restored = (res.details || []).map((d, idx) => {
                const prodMeta = prodMap[d.itemId];
                return {
                    productCode: d.itemId,
                    description: (prodMeta && prodMeta.description) ? prodMeta.description : '',
                    unitPrice: d.unitPrice,
                    qty: d.quantity || 0,
                    total: (d.quantity || 0) * (d.unitPrice || 0),
                    uid: this.generateLineUid(d.itemId || `saved-${idx}`)
                };
            });
            this.selectedProducts = restored;

            this.displayedProducts = (this.allProducts || []).map(prod => {
                const sel = this.selectedProducts.find(s => s.productCode === prod.productCode);
                return {
                    ...prod,
                    qty: sel ? sel.qty : 0,
                    total: sel ? sel.qty * prod.unitPrice : 0
                };
            });

            this.grandTotal = this.selectedProducts.reduce((sum, p) => sum + (p.total || 0), 0);

            if (res.header && res.header.repNumber && !this.repNumberFromAccount) {
                this.repNumberFromAccount = res.header.repNumber;
            }
            if (!this.selectedForm) {
                this.selectedForm = 'MILBON';
            }
            this.showInfoMenu = false;
            this.dispatchEvent(new ShowToastEvent({
                title: 'Saved Form Loaded',
                message: `PO ${res.header?.poNumber || ''} restored.`,
                variant: 'success'
            }));
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Load Failed',
                message: e && e.message ? e.message : 'An unexpected error occurred while loading the saved form.',
                variant: 'error'
            }));
        }
    }

    // Load saved drafts for this customer + form
    async loadSavedForms() {
        if (!this.selectedCustomer?.customerId || !this.isMilbon) {
            this.savedForms = [];
            return;
        }
        this.savedFormsLoading = true;
        try {
            const rows = await getSavedForms({ customerId: this.selectedCustomer.customerId, formName: 'Milbon' });
            this.savedForms = (rows || []).map(row => {
                const created = row.CreatedDate || row.createdDate;
                const total = row.OrderTotal__c ?? row.orderTotal;
                return {
                    ...row,
                    formattedDate: this.formatDate(created),
                    formattedTotal: this.formatCurrency(total)
                };
            });
        } catch (e) {
            this.savedForms = [];
            // optional toast
        } finally {
            this.savedFormsLoading = false;
        }
    }

    generateLineUid(baseId) {
        const sanitized = baseId ? String(baseId).replace(/[^a-zA-Z0-9]/g, '').substring(0, 12) : 'line';
        const randomPart = Math.floor(Math.random() * 1000000);
        return `${sanitized}-${Date.now()}-${randomPart}`;
    }

    async handleSaveOrComplete(statusOrEvent) {
        // Support being called as handler (event) or directly (string)
        let status = typeof statusOrEvent === 'string'
            ? statusOrEvent
            : (statusOrEvent && statusOrEvent.target && statusOrEvent.target.dataset && statusOrEvent.target.dataset.status) || 'COMPLETE';
        // status: 'SAVED' or 'COMPLETE'
        // Basic client-side validations (allow lighter for SAVED if desired)
        if (!this.selectedCustomer) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Select a customer',
                message: 'Please search and select a customer before submitting.',
                variant: 'warning'
            }));
            return;
        }
        if (!this.selectedCustomer.customerId) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Invalid Customer',
                message: 'The selected customer does not have a Customer ID. Please select a different customer or update the account.',
                variant: 'warning'
            }));
            return;
        }
        if (this.selectedForm !== 'MILBON') {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Select a form',
                message: 'Please select the Milbon form before proceeding.',
                variant: 'warning'
            }));
            return;
        }

        const validLines = (this.selectedProducts || []).filter(p => p.qty && p.qty > 0);

        // For COMPLETE, enforce at least one line; for SAVED, allow zero lines if you later want drafts without lines.
        if (status === 'COMPLETE' && validLines.length === 0) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Add products',
                message: 'Please add at least one product with quantity greater than zero.',
                variant: 'warning'
            }));
            return;
        }

        if (!this.repNumberFromAccount) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Missing Sales Rep Number',
                message: 'The selected customer Account does not have a Sales Rep Number (XC_SalesRepId__c).',
                variant: status === 'COMPLETE' ? 'warning' : 'info'
            }));
        }

        const payload = [{
            customerId: this.selectedCustomer.customerId,
            repNumber: this.repNumberFromAccount,
            formName: 'Milbon',
            formStatus: status,
            lines: validLines.map(p => ({
                itemId: p.productCode,
                quantity: p.qty,
                unitPrice: p.unitPrice,
                message: null,
                shipWithNext: null
            }))
        }];

        this.submitting = true;
        try {
            const res = await submitOrders({ requests: payload });
            const first = (res && res.length > 0) ? res[0] : null;
            if (!first || !first.success) {
                const msg = (first && first.message) ? first.message : `Unknown error during ${status === 'SAVED' ? 'save' : 'completion'}.`;
                throw new Error(msg);
            }

            if (status === 'SAVED') {
                this.showSuccessPopup({
                    heading: 'Draft Saved',
                    message: `Draft saved. PO: ${first.poNumber || 'N/A'}`,
                    poNumber: first.poNumber,
                    accountName: this.selectedCustomer.accountName,
                    orderTotal: first.orderTotal
                });
                if (this.selectedCustomer?.customerId) {
                    this.fetchRecentRedemptionForms(this.selectedCustomer.customerId);
                    this.loadSavedForms();
                }
            } else {
                this.showSuccessPopup({
                    heading: 'Order Submitted Successfully',
                    message: 'Your order has been submitted successfully!',
                    poNumber: first.poNumber,
                    accountName: this.selectedCustomer.accountName,
                    orderTotal: first.orderTotal
                });
                if (this.selectedCustomer?.customerId) {
                    this.fetchRecentRedemptionForms(this.selectedCustomer.customerId);
                }
            }
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: status === 'SAVED' ? 'Save Failed' : 'Submission Failed',
                message: e && e.message ? e.message : 'An unexpected error occurred.',
                variant: 'error'
            }));
        } finally {
            this.submitting = false;
        }
    }

    // Backward compatible handler name used by the existing button before we swapped HTML
    async handleSubmitOrder() {
        return this.handleSaveOrComplete('COMPLETE');
    }

    handleSaveClick() {
        this.handleSaveOrComplete('SAVED');
    }
    handleCompleteClick() {
        this.handleSaveOrComplete('COMPLETE');
    }

    closeSuccessModal() {
        this.showSuccessModal = false;
        if (this.modalCloseTimer) {
            clearTimeout(this.modalCloseTimer);
            this.modalCloseTimer = null;
        }
        // Reset UI state
        this.selectedCustomer = null;
        this.selectedForm = undefined;
        this.clearSelectedProducts();
        this.grandTotal = 0;
        this.searchTerm = '';
        this.searchResults = [];
        this.repNumberFromAccount = null;
        this.recentRedemptionForms = [];
        this.recentOrders = [];
        this.savedForms = [];
        this.showInfoMenu = false;
        this.successMessage = {};
    }

    showSuccessPopup(payload) {
        if (this.modalCloseTimer) {
            clearTimeout(this.modalCloseTimer);
        }
        this.successMessage = payload;
        this.showSuccessModal = true;
        this.showInfoMenu = false;
        this.modalCloseTimer = setTimeout(() => this.closeSuccessModal(), 3000);
    }
}
