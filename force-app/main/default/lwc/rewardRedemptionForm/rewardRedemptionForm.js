import { LightningElement, track, wire } from "lwc";
import isGuest from "@salesforce/user/isGuest";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import searchCustomers from "@salesforce/apex/SSG_CustomerSearch.searchCustomers";
import getUserInfo from "@salesforce/apex/SSG_CustomerSearch.getUserInfo";
import getRelevantOrders from "@salesforce/apex/SSG_CustomerSearch.getRelevantOrders";
import getRedemptionItems from "@salesforce/apex/RedemptionItemsAdminController.getRedemptionItems";
import submitOrders from "@salesforce/apex/RedemptionOrderService.submitOrders";
import getAccountRepNumber from "@salesforce/apex/SSG_CustomerSearch.getAccountRepNumber";
import getRecentRedemptionForms from "@salesforce/apex/RedemptionOrderService.getRecentRedemptionForms";
import getSavedForms from "@salesforce/apex/RedemptionOrderService.getSavedForms";
import loadFormWithDetails from "@salesforce/apex/RedemptionOrderService.loadFormWithDetails";
import getAllForms from "@salesforce/apex/FormDivisionLookup.getAllForms";

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
  // Confirmation modal state
  @track showConfirmModal = false;
  @track confirmModalMessage = '';
  _confirmAction = null;
  modalCloseTimer;
  @track inlineError = '';
  @track _formRegistry = [];

  @wire(getAllForms)
  wiredFormRegistry({ data, error }) {
    if (data) {
      this._formRegistry = data;
    } else if (error) {
      console.error('Error loading form registry:', error);
    }
  }

  // Build the form selector options dynamically from the registry.
  // Parent forms are top-level options. Sub-forms that share a division
  // with their parent (e.g. Milbon Gold, J Beverly Hills Concept) appear
  // as indented entries directly in the dropdown.
  // Diamond and Platinum remain handled via the customerType radio group
  // inside Milbon, so they are excluded from the dropdown.
  get formOptions() {
    const hiddenSubForms = new Set(['MILBON-PLATINUM', 'MILBON-DIAMOND']);
    const options = [];
    const parents = this._formRegistry.filter((f) => !f.isSubForm);
    for (const parent of parents) {
      const key = parent.formName.toUpperCase().replace(/\s+/g, '-');
      options.push({ label: parent.formName, value: key });
      const subs = this._formRegistry.filter(
        (f) => f.isSubForm && f.parentForm === parent.formName
      );
      for (const sub of subs) {
        const subKey = sub.formName.toUpperCase().replace(/\s+/g, '-');
        if (hiddenSubForms.has(subKey)) continue; // handled by radio group
        options.push({ label: '\u00A0\u00A0\u00A0\u2514 ' + sub.formName, value: subKey });
      }
    }
    return options;
  }

  // Resolve the currently selected form key back to a registry entry
  get currentFormEntry() {
    const key = this.selectedForm;
    if (!key || !this._formRegistry.length) return null;
    return this._formRegistry.find((f) => {
      const fKey = f.formName.toUpperCase().replace(/\s+/g, '-');
      return fKey === key;
    }) || null;
  }

  // Division ID for the active form selection
  get currentDivisionId() {
    return this.currentFormEntry ? this.currentFormEntry.divisionId : null;
  }

  // The canonical formName stored in the registry (used for API calls)
  get currentFormName() {
    return this.currentFormEntry ? this.currentFormEntry.formName : null;
  }

  // Customer type radio (None, Diamond, Platinum)
  customerTypeOptions = [
    { label: "None", value: "NONE" },
    { label: "Diamond", value: "DIAMOND" },
    { label: "Platinum", value: "PLATINUM" }
  ];
  @track customerType = "NONE";
  // Header-level shipping fields
  shipWithNextOptions = [
    { label: "Yes", value: "Y" },
    { label: "No", value: "N" }
  ];
  shipToStoreOptions = [
    { label: "Yes", value: "Y" },
    { label: "No", value: "N" }
  ];
  @track shipWithNext = "Y";
  @track shipToStore = "N";
  @track storeToShipToMessage = "";

  get hasSelectedForm() {
    return !!this.selectedForm;
  }

  get showShipToStore() {
    return this.shipWithNext === "N";
  }

  get showStoreToShipToMessage() {
    return this.showShipToStore && this.shipToStore === "Y";
  }

  get normalizedCustomerType() {
    return (this.customerType || "NONE").toUpperCase();
  }

  get isDiamond() {
    return this.normalizedCustomerType === "DIAMOND";
  }
  get isPlatinum() {
    return this.normalizedCustomerType === "PLATINUM";
  }

  _switchingTab = false;

  handleCustomerTypeChange(event) {
    const newType = event.detail.value;
    this._switchingTab = true;
    this.customerType = newType;
    // Always clear special selection on any type change
    this.specialSelectedProducts = [];
    this.specialProductSearchTerm = "";
    this.specialAllProducts = [];
    this.specialDisplayedProducts = [];
    const targetTab =
      newType === "DIAMOND" || newType === "PLATINUM" ? "special" : "standard";
    // Only update activeProductTab if it actually needs to change
    if (this.activeProductTab !== targetTab) {
      this.activeProductTab = targetTab;
    }
    if (newType === "DIAMOND" || newType === "PLATINUM") {
      this.loadSpecialProducts();
    }
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
      this._switchingTab = false;
    }, 200);
  }

  handleShipWithNextChange(event) {
    this.shipWithNext = event.detail.value;
    if (this.shipWithNext !== "N") {
      this.shipToStore = "N";
      this.storeToShipToMessage = "";
    }
  }

  handleShipToStoreChange(event) {
    this.shipToStore = event.detail.value;
    if (this.shipToStore !== "Y") {
      this.storeToShipToMessage = "";
    }
  }

  handleStoreToShipToMessageChange(event) {
    this.storeToShipToMessage = event.detail.value || event.target.value;
  }

  normalizeYesNo(value, fallback = "N") {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "Y" || normalized === "YES" || normalized === "TRUE") {
      return "Y";
    }
    if (normalized === "N" || normalized === "NO" || normalized === "FALSE") {
      return "N";
    }
    return fallback;
  }

  // Returns required item count for special tab
  get specialRequiredCount() {
    if (this.isDiamond) return 30;
    if (this.isPlatinum) return 60;
    return "";
  }

  get specialTotalSelectedQty() {
    return (this.specialSelectedProducts || []).reduce(
      (sum, item) => sum + (item.qty || 0),
      0
    );
  }

  get specialRemainingCount() {
    const required = Number(this.specialRequiredCount) || 0;
    if (!required) {
      return 0;
    }
    return Math.max(required - this.specialTotalSelectedQty, 0);
  }

  get specialRequirementMet() {
    const required = Number(this.specialRequiredCount) || 0;
    return required > 0 && this.specialRemainingCount === 0;
  }

  get specialRequirementInProgress() {
    const required = Number(this.specialRequiredCount) || 0;
    return required > 0 && this.specialRemainingCount > 0;
  }
  @track activeProductTab = "standard";

  // Special tab product search state
  @track specialProductSearchTerm = "";
  @track specialAllProducts = [];
  @track specialDisplayedProducts = [];
  @track specialSelectedProducts = [];
  @track isLoadingSpecialProducts = false;

  @track searchTerm = "";
  @track isSearching = false;
  searchTimeout;
  requestSeq = 0;

  // Product search and selection
  @track productSearchTerm = "";
  @track allProducts = [];
  @track displayedProducts = []; // Changed from getter to @track
  @track selectedProducts = []; // { productCode, description, unitPrice, qty, total }
  @track isLoadingProducts = false;

  @wire(getUserInfo)
  wiredUser({ error, data }) {
    if (data) {
      this.loggedInRepId = data.repId;
    } else if (error) {
      console.error("User Info Error:", error);
    }
  }

  connectedCallback() {
    // Prevent login loop: always redirect guests to the standard site login page.
    if (isGuest) {
      const currentPath = window.location.pathname;
      const loginPath = "/s/login";
      if (!currentPath.startsWith(loginPath)) {
        const startUrl = encodeURIComponent(currentPath || "/");
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
      .then((result) => {
        if (currentSeq === this.requestSeq) {
          // Use spread to ensure the tracked array updates properly
          this.searchResults = result ? [...result] : [];
        }
      })
      .catch((error) => {
        console.error("Search error:", error);
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
    return (
      !this.isSearching &&
      this.searchTerm.length >= 2 &&
      (!this.searchResults || this.searchResults.length === 0)
    );
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
    // Milbon parent or any Milbon sub-form (Gold, Platinum, Diamond)
    const entry = this.currentFormEntry;
    if (!entry) return false;
    return entry.formName === 'Milbon' || entry.parentForm === 'Milbon';
  }

  get activeRepNumber() {
    if (this.loggedInRepId) {
      const parsed = Number(this.loggedInRepId);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    if (
      this.repNumberFromAccount != null &&
      !Number.isNaN(this.repNumberFromAccount)
    ) {
      return this.repNumberFromAccount;
    }
    return null;
  }

  get isInsightsDisabled() {
    return !this.activeRepNumber;
  }

  async handleSelect(event) {
    const custId = event.currentTarget.dataset.id;
    const sel = this.searchResults.find(
      (c) => c.customerId === custId || c.accountId === custId
    );

    if (sel) {
      this.selectedCustomer = sel;
      this.selectedForm = undefined;
      this.clearSelectedProducts();
      this.showInfoMenu = false;
      this.savedForms = [];
      this.recentOrders = [];
      this.recentRedemptionForms = [];
      this.searchResults = [];
      // Clear searchTerm so input is empty and dropdown is hidden
      this.searchTerm = "";

      // Fetch relevant orders for the selected customer
      this.fetchRelevantOrders(sel.accountId);
      // Fetch recent redemption forms
      this.fetchRecentRedemptionForms(sel.customerId);

      // Fetch rep number from Account.XC_SalesRepId__c
      try {
        const repNum = await getAccountRepNumber({ accountId: sel.accountId });
        this.repNumberFromAccount = repNum;
      } catch {
        this.repNumberFromAccount = null;
        // Non-blocking; surface info on submit if missing
      }
    }
  }

  fetchRelevantOrders(accountId) {
    getRelevantOrders({ accountId })
      .then((result) => {
        // Format dates for display; displayNumber provided by Apex fallback to Name
        this.recentOrders = (result || []).map((order) => ({
          id: order.id,
          date: this.formatDate(order.createdDate),
          total: order.totalAmount,
          formattedTotal: this.formatCurrency(order.totalAmount),
          status: order.status,
          number: order.displayNumber
        }));
      })
      .catch((error) => {
        console.error("Error fetching relevant orders:", error);
        // Fallback to mock data if API call fails
        this.recentOrders = [
          {
            id: "ord1",
            date: "2026-01-10",
            total: 145.0,
            formattedTotal: this.formatCurrency(145.0),
            status: "Completed"
          },
          {
            id: "ord2",
            date: "2025-12-15",
            total: 320.5,
            formattedTotal: this.formatCurrency(320.5),
            status: "Completed"
          }
        ];
      });
  }

  // Fetch recent redemption forms for the selected customer
  async fetchRecentRedemptionForms(customerId) {
    if (!customerId) return;
    this.recentRedemptionFormsLoading = true;
    try {
      const forms = await getRecentRedemptionForms({ customerId });
      this.recentRedemptionForms = (forms || []).map((form) => ({
        id: form.Id || form.id,
        poNumber: form.PONumber__c || "N/A",
        orderTotal: form.OrderTotal__c || 0,
        formattedDate: this.formatDate(form.CreatedDate || form.createdDate),
        formattedTotal: this.formatCurrency(form.OrderTotal__c)
      }));
    } catch (error) {
      console.error("Error fetching recent redemption forms:", error);
      this.recentRedemptionForms = [];
    } finally {
      this.recentRedemptionFormsLoading = false;
    }
  }

  formatDate(dateString) {
    if (!dateString) return "Unknown date";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return dateString;
    }
  }

  formatCurrency(value) {
    if (value == null || isNaN(value)) return "N/A";
    return `$${Number(value).toFixed(2)}`;
  }

  get modalHeading() {
    return this.successMessage.heading || "Order Submitted Successfully";
  }

  get modalMessage() {
    return (
      this.successMessage.message ||
      "Your order has been submitted successfully!"
    );
  }

  get modalOrderTotal() {
    return this.successMessage.orderTotal != null
      ? `$${this.successMessage.orderTotal}`
      : "N/A";
  }

  handleFormChange(event) {
    this.selectedForm = event.detail.value;
    this.savedForms = [];
    this.shipWithNext = "Y";
    this.shipToStore = "N";
    this.storeToShipToMessage = "";
    // Fetch products based on resolved division and promo tier
    const entry = this.currentFormEntry;
    if (entry && entry.divisionId) {
      this.fetchProducts(String(entry.divisionId), entry.promoTier || null);
      // Reset customer type and special tab
      this.customerType = "NONE";
      this.activeProductTab = "standard";
      this.specialProductSearchTerm = "";
      this.specialAllProducts = [];
      this.specialDisplayedProducts = [];
      this.specialSelectedProducts = [];
      this.isLoadingSpecialProducts = false;
    }
  }

  // (Checkbox handlers removed; replaced by radio group logic)

  // Tab switching
  handleProductTabChange(event) {
    // Skip if we're programmatically switching tabs (avoids render loop)
    if (this._switchingTab) return;
    const newVal = event.target.value;
    if (newVal && newVal !== this.activeProductTab) {
      this.activeProductTab = newVal;
    }
  }

  // Dynamic label for special tab
  get specialTabLabel() {
    if (this.isDiamond) return "Diamond Items";
    if (this.isPlatinum) return "Platinum Items";
    return "Special Items";
  }

  get hasSpecialTab() {
    return this.isDiamond || this.isPlatinum;
  }

  // Load special products from SSG_RedemptionItems__c by division + promoTier
  loadSpecialProducts() {
    const promoTier = this.isDiamond ? 'Diamond' : this.isPlatinum ? 'Platinum' : null;
    if (!promoTier) return;
    const divisionId = this.currentDivisionId;
    if (!divisionId) return;
    this.isLoadingSpecialProducts = true;
    getRedemptionItems({ divisionId, promoTier })
      .then((result) => {
        this.specialAllProducts = (result || []).map((item) => ({
          productCode: item.itemId,
          description: item.description,
          unitPrice: item.unitPrice || 0
        }));
        this.specialDisplayedProducts = this.specialAllProducts.map((prod) => ({
          ...prod,
          qty: 0
        }));
      })
      .catch((error) => {
        console.error('Error loading special products:', error);
        this.specialAllProducts = [];
        this.specialDisplayedProducts = [];
      })
      .finally(() => {
        this.isLoadingSpecialProducts = false;
      });
  }
  handleSpecialProductSearchChange(event) {
    this.specialProductSearchTerm = event.target.value.toLowerCase();
    if (this.specialProductSearchTerm.length === 0) {
      this.specialDisplayedProducts = this.specialAllProducts.map((prod) => {
        const selected = this.specialSelectedProducts.find(
          (s) => s.productCode === prod.productCode
        );
        return {
          ...prod,
          qty: selected ? selected.qty : 0
        };
      });
    } else {
      this.specialDisplayedProducts = this.specialAllProducts
        .filter(
          (prod) =>
            prod.productCode
              .toLowerCase()
              .includes(this.specialProductSearchTerm) ||
            prod.description
              .toLowerCase()
              .includes(this.specialProductSearchTerm)
        )
        .slice(0, 40)
        .map((prod) => {
          const selected = this.specialSelectedProducts.find(
            (s) => s.productCode === prod.productCode
          );
          return {
            ...prod,
            qty: selected ? selected.qty : 0
          };
        });
    }
  }
  clearSpecialProductSearch() {
    this.specialProductSearchTerm = "";
    this.specialDisplayedProducts = this.specialAllProducts.map((prod) => {
      const selected = this.specialSelectedProducts.find(
        (s) => s.productCode === prod.productCode
      );
      return {
        ...prod,
        qty: selected ? selected.qty : 0
      };
    });
  }
  handleSpecialProductQtyChange(event) {
    const productCode = event.target.dataset.code;
    const desiredQty = parseInt(event.target.value, 10);
    const required = Number(this.specialRequiredCount) || 0;
    if (!required) {
      return;
    }
    const sanitizedQty = Number.isNaN(desiredQty) ? 0 : Math.max(desiredQty, 0);
    const existing = this.specialSelectedProducts.find(
      (p) => p.productCode === productCode
    );
    const otherQty = (this.specialSelectedProducts || []).reduce(
      (sum, p) => sum + (p.productCode === productCode ? 0 : p.qty),
      0
    );
    const allowed = Math.max(required - otherQty, 0);
    const finalQty = Math.min(sanitizedQty, allowed);

    let updated = (this.specialSelectedProducts || []).filter(
      (p) => p.productCode !== productCode
    );
    if (finalQty > 0) {
      const prod = this.specialAllProducts.find(
        (p) => p.productCode === productCode
      );
      if (prod) {
        updated = [
          ...updated,
          {
            productCode: prod.productCode,
            description: prod.description,
            qty: finalQty,
            uid: existing?.uid || this.generateLineUid(prod.productCode)
          }
        ];
      }
    }
    this.specialSelectedProducts = updated;
    this.specialDisplayedProducts = this.specialDisplayedProducts.map((prod) => {
      const selected = this.specialSelectedProducts.find(
        (s) => s.productCode === prod.productCode
      );
      return {
        ...prod,
        qty: selected ? selected.qty : 0
      };
    });
  }

  get isSpecialSearchDisabled() {
    return this.specialProductSearchTerm.length === 0;
  }
  get specialNoProductsFound() {
    return this.specialDisplayedProducts.length === 0;
  }

  // Enforce item count for Platinum (60) and Diamond (30)
  get specialTabSubmitDisabled() {
    const required = Number(this.specialRequiredCount) || 0;
    if (!required) {
      return false;
    }
    return this.specialRemainingCount !== 0;
  }

  fetchProducts(division, promoTier = null) {
    this.isLoadingProducts = true;
    this.isLoadingSpecialProducts = this.hasSpecialTab;
    this.productSearchTerm = "";
    const divisionId = parseInt(division, 10);
    getRedemptionItems({ divisionId, promoTier })
      .then((result) => {
        this.allProducts = (result || []).map((item) => ({
          productCode: item.itemId,
          description: item.description,
          unitPrice: item.unitPrice || 0
        }));
        this.displayedProducts = this.allProducts.map((prod) => ({
          ...prod,
          qty: 0,
          total: 0
        }));
      })
      .catch((error) => {
        console.error("Error fetching products:", error);
        this.allProducts = [];
        this.displayedProducts = [];
      })
      .finally(() => {
        this.isLoadingProducts = false;
        this.isLoadingSpecialProducts = false;
      });
  }

  handleProductSearchChange(event) {
    this.productSearchTerm = event.target.value.toLowerCase();
    if (this.productSearchTerm.length === 0) {
      this.displayedProducts = this.allProducts.map((prod) => {
        const selected = this.selectedProducts.find(
          (s) => s.productCode === prod.productCode
        );
        return {
          ...prod,
          qty: selected ? selected.qty : 0,
          total: selected ? selected.qty * prod.unitPrice : 0
        };
      });
    } else {
      this.displayedProducts = this.allProducts
        .filter(
          (prod) =>
            prod.productCode.toLowerCase().includes(this.productSearchTerm) ||
            prod.description.toLowerCase().includes(this.productSearchTerm)
        )
        .slice(0, 40)
        .map((prod) => {
          const selected = this.selectedProducts.find(
            (s) => s.productCode === prod.productCode
          );
          return {
            ...prod,
            qty: selected ? selected.qty : 0,
            total: selected ? selected.qty * prod.unitPrice : 0
          };
        });
    }
  }

  clearProductSearch() {
    this.productSearchTerm = "";
    this.displayedProducts = this.allProducts.map((prod) => {
      const selected = this.selectedProducts.find(
        (s) => s.productCode === prod.productCode
      );
      return {
        ...prod,
        qty: selected ? selected.qty : 0,
        total: selected ? selected.qty * prod.unitPrice : 0
      };
    });
  }

  handleProductQtyChange(event) {
    const productCode = event.target.dataset.code;
    const newQty = parseInt(event.target.value, 10) || 0;
    const existing = this.selectedProducts.find(
      (p) => p.productCode === productCode
    );
    if (existing) {
      existing.qty = newQty;
      existing.total = existing.qty * existing.unitPrice;
    } else if (newQty > 0) {
      const prod = this.allProducts.find((p) => p.productCode === productCode);
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
    this.selectedProducts = this.selectedProducts.filter((p) => p.qty > 0);
    // Update displayed products
    this.updateDisplayedProducts();
    // Update grand total
    this.grandTotal = this.selectedProducts.reduce(
      (sum, p) => sum + p.total,
      0
    );
  }

  updateDisplayedProducts() {
    // Update the current displayedProducts with selected qtys
    this.displayedProducts = this.displayedProducts.map((prod) => {
      const selected = this.selectedProducts.find(
        (s) => s.productCode === prod.productCode
      );
      return {
        ...prod,
        qty: selected ? selected.qty : 0,
        total: selected ? selected.qty * prod.unitPrice : 0
      };
    });
  }

  // Confirmation modal helpers
  openConfirmModal(message, action) {
    this.confirmModalMessage = message;
    this._confirmAction = action;
    this.showConfirmModal = true;
  }
  async handleConfirmYes() {
    this.showConfirmModal = false;
    if (this._confirmAction) {
      try {
        await Promise.resolve(this._confirmAction());
      } catch (e) {
        const errMsg = e && e.message ? e.message : "Unable to complete the requested action.";
        this.showInlineError(errMsg);
      }
    }
    this._confirmAction = null;
  }
  handleConfirmNo() {
    this.showConfirmModal = false;
    this._confirmAction = null;
  }

  // Clear the current form selections
  handleClearFormClick() {
    this.openConfirmModal(
      'Are you sure you want to clear the form? All selections will be lost.',
      () => this.clearSelectedProducts()
    );
  }

  clearSelectedProducts() {
    this.selectedProducts = [];
    this.displayedProducts = (this.allProducts || []).map((prod) => ({
      ...prod,
      qty: 0,
      total: 0
    }));
    // Clear special-tab selections as well so Diamond/Platinum is fully reset.
    this.specialSelectedProducts = [];
    this.specialProductSearchTerm = "";
    this.specialDisplayedProducts = (this.specialAllProducts || []).map((prod) => ({
      ...prod,
      qty: 0
    }));
    this.shipWithNext = "Y";
    this.shipToStore = "N";
    this.storeToShipToMessage = "";
    this.grandTotal = 0;
  }

  openInfoMenu() {
    if (!this.activeRepNumber) return;
    this.showInfoMenu = true;
    if (this.selectedCustomer?.customerId) {
      this.fetchRecentRedemptionForms(this.selectedCustomer.customerId);
    }
    this.loadSavedForms();
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
        throw new Error(
          res && res.message ? res.message : "Unable to load saved form."
        );
      }
      if (
        this.isMilbon &&
        (!this.allProducts || this.allProducts.length === 0)
      ) {
        const div = this.currentDivisionId;
        const entry = this.currentFormEntry;
        if (div) await this.fetchProducts(String(div), entry?.promoTier || null);
      }

      // Restore customer type (Diamond/Platinum) from saved header
      const savedPromoTier = res.header?.promoTier;
      if (savedPromoTier === 'DIAMOND' || savedPromoTier === 'PLATINUM') {
        this.customerType = savedPromoTier;
      } else {
        this.customerType = 'NONE';
      }
      this.shipWithNext = this.normalizeYesNo(res.header?.shipWithNext, "Y");
      this.shipToStore = this.normalizeYesNo(res.header?.shipToStore, "N");
      this.storeToShipToMessage = res.header?.headerMessage || "";

      const prodMap = {};
      (this.allProducts || []).forEach((p) => {
        prodMap[p.productCode] = p;
      });

      // Split details by detail promo tier (new source of truth), with fallback to isSpecial.
      const standardDetails = (res.details || []).filter((d) => {
        const tier = (d.promoTier || "").toLowerCase();
        return tier !== "diamond" && tier !== "platinum" && !d.isSpecial;
      });
      const specialDetails = (res.details || []).filter((d) => {
        const tier = (d.promoTier || "").toLowerCase();
        return tier === "diamond" || tier === "platinum" || d.isSpecial;
      });

      const restoredStandard = standardDetails.map((d, idx) => {
        const prodMeta = prodMap[d.itemId];
        return {
          productCode: d.itemId,
          description:
            prodMeta && prodMeta.description ? prodMeta.description : "",
          unitPrice: d.unitPrice,
          qty: d.quantity || 0,
          total: (d.quantity || 0) * (d.unitPrice || 0),
          uid: this.generateLineUid(d.itemId || `saved-${idx}`)
        };
      });
      this.selectedProducts = restoredStandard;

      this.displayedProducts = (this.allProducts || []).map((prod) => {
        const sel = this.selectedProducts.find(
          (s) => s.productCode === prod.productCode
        );
        return {
          ...prod,
          qty: sel ? sel.qty : 0,
          total: sel ? sel.qty * prod.unitPrice : 0
        };
      });

      this.grandTotal = this.selectedProducts.reduce(
        (sum, p) => sum + (p.total || 0),
        0
      );

      // Restore special tab items if Diamond/Platinum
      if (this.isDiamond || this.isPlatinum) {
        await this.loadSpecialProducts();
        const restoredSpecial = specialDetails.map((d, idx) => ({
          productCode: d.itemId,
          description: d.itemId,
          qty: d.quantity || 0,
            promoTier: d.promoTier || (this.isDiamond ? 'Diamond' : this.isPlatinum ? 'Platinum' : null),
          uid: this.generateLineUid(d.itemId || `special-${idx}`)
        }));
        // Merge descriptions from loaded special products
        this.specialSelectedProducts = restoredSpecial.map((item) => {
          const match = this.specialAllProducts.find(
            (p) => p.productCode === item.productCode
          );
          return {
            ...item,
            description: match ? match.description : item.description
          };
        });
        // Update displayed products with restored qty
        this.specialDisplayedProducts = this.specialAllProducts.map((prod) => {
          const sel = this.specialSelectedProducts.find(
            (s) => s.productCode === prod.productCode
          );
          return { ...prod, qty: sel ? sel.qty : 0 };
        });
        this.activeProductTab = 'special';
      } else {
        this.specialSelectedProducts = [];
        this.specialAllProducts = [];
        this.specialDisplayedProducts = [];
        this.activeProductTab = 'standard';
      }

      if (res.header && res.header.repNumber && !this.repNumberFromAccount) {
        this.repNumberFromAccount = res.header.repNumber;
      }
      if (!this.selectedForm) {
        // Try to restore the form selection from the saved header's formName
        const savedFormName = res.header?.formName;
        if (savedFormName) {
          const match = this._formRegistry.find(
            (f) => f.formName.toLowerCase() === savedFormName.toLowerCase()
          );
          if (match) {
            this.selectedForm = match.formName.toUpperCase().replace(/\s+/g, '-');
          }
        }
        if (!this.selectedForm) {
          this.selectedForm = "MILBON";
        }
      }
      this.showInfoMenu = false;
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Saved Form Loaded",
          message: `PO ${res.header?.poNumber || ""} restored.`,
          variant: "success"
        })
      );
    } catch (e) {
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Load Failed",
          message:
            e && e.message
              ? e.message
              : "An unexpected error occurred while loading the saved form.",
          variant: "error"
        })
      );
    }
  }

  // Load saved drafts for the current rep (optionally scoped to the active customer)
  async loadSavedForms() {
    const repNumber = this.activeRepNumber;
    if (!repNumber) {
      this.savedForms = [];
      return;
    }
    this.savedFormsLoading = true;
    try {
      const rows = await getSavedForms({
        customerId: this.selectedCustomer?.customerId || null,
        formName: this.currentFormName || "Milbon",
        repNumber
      });
      this.savedForms = (rows || []).map((row) => {
        const created = row.CreatedDate || row.createdDate;
        const total = row.OrderTotal__c ?? row.orderTotal;
        return {
          ...row,
          formattedDate: this.formatDate(created),
          formattedTotal: this.formatCurrency(total)
        };
      });
    } catch {
      this.savedForms = [];
      // optional toast
    } finally {
      this.savedFormsLoading = false;
    }
  }

  generateLineUid(baseId) {
    const sanitized = baseId
      ? String(baseId)
          .replace(/[^a-zA-Z0-9]/g, "")
          .substring(0, 12)
      : "line";
    const randomPart = Math.floor(Math.random() * 1000000);
    return `${sanitized}-${Date.now()}-${randomPart}`;
  }

  showInlineError(message) {
    this.inlineError = message;
    console.error('[RewardRedemptionForm]', message);
  }

  clearInlineError() {
    this.inlineError = '';
  }

  validateSpecialTierRequirementForComplete() {
    if (!this.isDiamond && !this.isPlatinum) {
      return true;
    }
    const required = this.isDiamond ? 30 : 60;
    const selected = this.specialTotalSelectedQty;
    if (selected === required) {
      return true;
    }
    const remaining = Math.max(required - selected, 0);
    const tierLabel = this.isDiamond ? "Diamond" : "Platinum";
    const qtyLabel = remaining === 1 ? "item" : "items";
    const msg = remaining > 0
      ? `You are missing ${remaining} ${tierLabel} ${qtyLabel}. Please add them in the ${tierLabel} Items tab before completing.`
      : `You have selected too many ${tierLabel} items. Please keep exactly ${required} before completing.`;
    this.showInlineError(msg);
    return false;
  }

  async handleSaveOrComplete(statusOrEvent) {
    // Support being called as handler (event) or directly (string)
    let status =
      typeof statusOrEvent === "string"
        ? statusOrEvent
        : (statusOrEvent &&
            statusOrEvent.target &&
            statusOrEvent.target.dataset &&
            statusOrEvent.target.dataset.status) ||
          "COMPLETE";
    // status: 'SAVED' or 'COMPLETE'
    this.clearInlineError();
    // Basic client-side validations (allow lighter for SAVED if desired)
    if (!this.selectedCustomer) {
      this.showInlineError("Please search and select a customer before submitting.");
      return;
    }
    if (!this.selectedCustomer.customerId) {
      this.showInlineError("The selected customer does not have a Customer ID. Please select a different customer or update the account.");
      return;
    }
    if (!this.currentFormEntry) {
      this.showInlineError("Please select a form before proceeding.");
      return;
    }

    // Merge standard and special products for payload (always merge both tabs)
    let validLines = (this.selectedProducts || []).filter(
      (p) => p.qty && p.qty > 0
    ).map((p) => ({ ...p, isSpecial: false }));
    if (this.isDiamond || this.isPlatinum) {
      const specialLines = (this.specialSelectedProducts || [])
        .filter((p) => p.qty && p.qty > 0)
        .map((p) => ({
          productCode: p.productCode,
          description: p.description,
          unitPrice: 0,
          qty: p.qty,
          total: 0,
          uid: p.uid,
          isSpecial: true,
          promoTier: this.isDiamond ? 'Diamond' : this.isPlatinum ? 'Platinum' : null
        }));
      // Remove any duplicates by productCode
      const existingCodes = new Set(validLines.map((l) => l.productCode));
      validLines = validLines.concat(
        specialLines.filter((l) => !existingCodes.has(l.productCode))
      );
    }

    // Diamond/Platinum item count enforcement — only on COMPLETE, not SAVED
    if (status === "COMPLETE") {
      if (!this.validateSpecialTierRequirementForComplete()) {
        return;
      }
    }

    // For COMPLETE, enforce at least one line across both tabs
    if (status === "COMPLETE" && validLines.length === 0) {
      this.showInlineError("Please add at least one product with quantity greater than zero.");
      return;
    }

    if (!this.repNumberFromAccount) {
      this.showInlineError("The selected customer Account does not have a Sales Rep Number (XC_SalesRepId__c). Cannot submit.");
      return;
    }

    const normalizedStoreMessage = String(this.storeToShipToMessage || "").trim();
    if (this.showStoreToShipToMessage && !normalizedStoreMessage) {
      this.showInlineError("Please enter a store name when Ship To Store is set to Yes.");
      return;
    }

    const payload = [
      {
        customerId: this.selectedCustomer.customerId,
        repNumber: this.repNumberFromAccount,
        formName: this.currentFormName,
        formStatus: status,
        customerType: this.customerType || "NONE",
        shipWithNext: this.normalizeYesNo(this.shipWithNext, "Y"),
        shipToStore: this.showShipToStore
          ? this.normalizeYesNo(this.shipToStore, "N")
          : "N",
        headerMessage: this.showStoreToShipToMessage
          ? normalizedStoreMessage
          : null,
        lines: validLines.map((p) => ({
          itemId: p.productCode,
          quantity: p.qty,
          unitPrice: p.unitPrice || 0,
          message: null,
          shipWithNext: null,
          isSpecial: p.isSpecial || false,
          promoTier: p.promoTier || null
        }))
      }
    ];

    this.submitting = true;
    try {
      const res = await submitOrders({ requests: payload });
      const first = res && res.length > 0 ? res[0] : null;
      if (!first || !first.success) {
        const msg =
          first && first.message
            ? first.message
            : `Unknown error during ${status === "SAVED" ? "save" : "completion"}.`;
        throw new Error(msg);
      }

      if (status === "SAVED") {
        this.showSuccessPopup({
          heading: "Draft Saved",
          message: `Draft saved. PO: ${first.poNumber || "N/A"}`,
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
          heading: "Order Submitted Successfully",
          message: "Your order has been submitted successfully!",
          poNumber: first.poNumber,
          accountName: this.selectedCustomer.accountName,
          orderTotal: first.orderTotal
        });
        if (this.selectedCustomer?.customerId) {
          this.fetchRecentRedemptionForms(this.selectedCustomer.customerId);
        }
      }
    } catch (e) {
      const errMsg = e && e.body && e.body.message
        ? e.body.message
        : e && e.message
          ? e.message
          : "An unexpected error occurred.";
      this.showInlineError(`${status === "SAVED" ? "Save" : "Submission"} Failed: ${errMsg}`);
    } finally {
      this.submitting = false;
    }
  }

  // Backward compatible handler name used by the existing button before we swapped HTML
  async handleSubmitOrder() {
    return this.handleSaveOrComplete("COMPLETE");
  }

  handleSaveClick() {
    this.openConfirmModal(
      'Are you sure you want to save this form?',
      () => this.handleSaveOrComplete('SAVED')
    );
  }
  handleCompleteClick() {
    if (!this.validateSpecialTierRequirementForComplete()) {
      return;
    }
    this.openConfirmModal(
      'Are you sure you want to submit this form?',
      () => this.handleSaveOrComplete('COMPLETE')
    );
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
    this.searchTerm = "";
    this.searchResults = [];
    this.repNumberFromAccount = null;
    this.recentRedemptionForms = [];
    this.recentOrders = [];
    this.savedForms = [];
    this.showInfoMenu = false;
    this.shipWithNext = "Y";
    this.shipToStore = "N";
    this.storeToShipToMessage = "";
    this.successMessage = {};
  }

  showSuccessPopup(payload) {
    if (this.modalCloseTimer) {
      clearTimeout(this.modalCloseTimer);
    }
    this.successMessage = payload;
    this.showSuccessModal = true;
    this.showInfoMenu = false;
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.modalCloseTimer = setTimeout(() => this.closeSuccessModal(), 3000);
  }
}
