import { LightningElement, track, wire } from 'lwc';
import getAvailableProducts from '@salesforce/apex/RedemptionItemsAdminController.getAvailableProducts';
import getRedemptionItems from '@salesforce/apex/RedemptionItemsAdminController.getRedemptionItems';
import addRedemptionItems from '@salesforce/apex/RedemptionItemsAdminController.addRedemptionItems';
import removeRedemptionItems from '@salesforce/apex/RedemptionItemsAdminController.removeRedemptionItems';
import getAllForms from '@salesforce/apex/FormDivisionLookup.getAllForms';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class RedemptionItemAdmin extends LightningElement {
    @track selectedForm = '';
    @track availableProducts = [];
    @track assignedItems = [];
    @track availableSearchTerm = '';
    @track assignedSearchTerm = '';
    @track selectedAvailableProductIds = [];
    @track selectedAssignedItemIds = [];
    @track isLoadingLists = false;
    @track isWorking = false;
    @track _formRegistry = [];

    lastAvailableIndex;
    lastAssignedIndex;

    @wire(getAllForms)
    wiredForms({ data, error }) {
        if (data) {
            this._formRegistry = data;
        } else if (error) {
            console.error('Error loading form registry:', error);
        }
    }


    get formOptions() {
        // Build a flat option list: parent forms first, sub-forms indented underneath their parent
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
                options.push({ label: '\u00A0\u00A0\u00A0\u2514 ' + sub.formName, value: subKey });
            }
        }
        return options;
    }

    get currentFormMeta() {
        const selectedKey = this.selectedForm;
        if (!selectedKey) return {};
        return this._formRegistry.find((f) => {
            const key = f.formName.toUpperCase().replace(/\s+/g, '-');
            return key === selectedKey;
        }) || {};
    }

    get currentDivisionId() {
        return this.currentFormMeta.divisionId || null;
    }

    get currentPromoTier() {
        return this.currentFormMeta.promoTier || null;
    }

    get filteredAvailableProducts() {
        const decorated = this.availableProducts.map((item) => ({
            ...item,
            cardClass: this.selectedAvailableProductIds.includes(item.productId)
                ? 'item-card item-card_selected'
                : 'item-card'
        }));
        let filtered = decorated;
        if (this.availableSearchTerm) {
            const term = this.availableSearchTerm.toLowerCase();
            filtered = decorated
                .filter((item) =>
                    (item.productCode || '')
                        .toLowerCase()
                        .includes(term) ||
                    (item.description || '')
                        .toLowerCase()
                        .includes(term)
                );
        }
        return filtered;
    }

    get moveRightDisabled() {
        return (
            this.selectedAvailableProductIds.length === 0 ||
            this.isWorking ||
            this.isLoadingLists ||
            !this.currentDivisionId
        );
    }

    get moveLeftDisabled() {
        return (
            this.selectedAssignedItemIds.length === 0 ||
            this.isWorking ||
            this.isLoadingLists
        );
    }

    handleFormChange(event) {
        if (this.selectedForm === event.detail.value) {
            return;
        }
        this.selectedForm = event.detail.value;
        this.availableSearchTerm = '';
        this.selectedAvailableProductIds = [];
        this.selectedAssignedItemIds = [];
        this.lastAvailableIndex = undefined;
        this.lastAssignedIndex = undefined;
        if (this.selectedForm) {
            this.refreshItemLists();
        } else {
            this.availableProducts = [];
            this.assignedItems = [];
        }
    }

    handleAvailableSearchChange(event) {
        this.availableSearchTerm = event.target.value;
    }

    handleAvailableItemClick(event) {
        const recordId = event.currentTarget.dataset.id;
        const index = Number(event.currentTarget.dataset.index);
        this.updateSelection(
            'available',
            recordId,
            index,
            event.shiftKey,
            event.ctrlKey || event.metaKey
        );
    }

    handleAssignedItemClick(event) {
        const recordId = event.currentTarget.dataset.id;
        const index = Number(event.currentTarget.dataset.index);
        this.updateSelection(
            'assigned',
            recordId,
            index,
            event.shiftKey,
            event.ctrlKey || event.metaKey
        );
    }

    handleMoveRight() {
        if (this.moveRightDisabled) {
            return;
        }
        const divisionId = this.currentDivisionId;
        const promoTier = this.currentPromoTier;
        const toAdd = this.selectedAvailableProductIds
            .map((id) => this.availableProducts.find((item) => item.productId === id))
            .filter((item) => item && item.productCode);
        if (!toAdd.length || !divisionId) {
            return;
        }
        this.isWorking = true;
        const itemsJson = JSON.stringify(
            toAdd.map((item) => ({
                productCode: item.productCode,
                description: item.description,
                unitPrice: item.unitPrice
            }))
        );
        // eslint-disable-next-line no-console
        console.log('addRedemptionItems itemsJson:', itemsJson, 'divisionId:', divisionId, 'promoTier:', promoTier);
        addRedemptionItems({ itemsJson, divisionId, promoTier })
            .then(() => {
                this.showToast(
                    'Items Added',
                    `${toAdd.length} item${toAdd.length > 1 ? 's' : ''} assigned to the form.`,
                    'success'
                );
                this.refreshItemLists();
            })
            .catch((error) => {
                this.showToast(
                    'Assignment Failed',
                    this.extractError(error),
                    'error'
                );
            })
            .finally(() => {
                this.isWorking = false;
            });
    }

    handleMoveLeft() {
        if (this.moveLeftDisabled) {
            return;
        }
        const idsToRemove = [...this.selectedAssignedItemIds];
        if (!idsToRemove.length) {
            return;
        }
        this.isWorking = true;
        removeRedemptionItems({ itemIds: idsToRemove })
            .then(() => {
                this.showToast(
                    'Items Removed',
                    `${idsToRemove.length} item${idsToRemove.length > 1 ? 's' : ''} removed from the form.`,
                    'success'
                );
                this.refreshItemLists();
            })
            .catch((error) => {
                this.showToast(
                    'Removal Failed',
                    this.extractError(error),
                    'error'
                );
            })
            .finally(() => {
                this.isWorking = false;
            });
    }

    refreshItemLists() {
        const divisionId = this.currentDivisionId;
        const promoTier = this.currentPromoTier;
        // eslint-disable-next-line no-console
        console.log('refreshItemLists - selectedForm:', this.selectedForm, 'divisionId:', divisionId, 'promoTier:', promoTier);
        if (!divisionId) {
            this.availableProducts = [];
            this.assignedItems = [];
            return;
        }
        this.isLoadingLists = true;
        Promise.all([
            getAvailableProducts({ divisionId, promoTier }),
            getRedemptionItems({ divisionId, promoTier })
        ])
            .then(([available, assigned]) => {
                this.availableProducts = (available || []).map((item) => ({
                    productId: item.productId,
                    productCode: item.productCode,
                    description: item.description,
                    unitPrice: item.unitPrice
                }));
                this.assignedItems = (assigned || []).map((item) => ({
                    redemptionId: item.redemptionId,
                    itemId: item.itemId,
                    description: item.description
                }));
            })
            .catch((error) => {
                this.showToast('Load Failed', this.extractError(error), 'error');
            })
            .finally(() => {
                this.isLoadingLists = false;
                this.selectedAvailableProductIds = [];
                this.selectedAssignedItemIds = [];
                this.availableSearchTerm = '';
                this.assignedSearchTerm = '';
                this.lastAvailableIndex = undefined;
                this.lastAssignedIndex = undefined;
            });
    }

    updateSelection(section, recordId, index, isShift, isModifier) {
        if (!recordId) {
            return;
        }
        const selectionKey =
            section === 'available'
                ? 'selectedAvailableProductIds'
                : 'selectedAssignedItemIds';
        const listData =
            section === 'available' ? this.filteredAvailableProducts : this.filteredAssignedItems;
        const lastIndexKey =
            section === 'available' ? 'lastAvailableIndex' : 'lastAssignedIndex';
        const idKey = section === 'available' ? 'productId' : 'redemptionId';

        let selectionSet = new Set(this[selectionKey] || []);

        if (isShift && this[lastIndexKey] != null && !isNaN(this[lastIndexKey])) {
            const start = Math.min(this[lastIndexKey], index);
            const end = Math.max(this[lastIndexKey], index);
            for (let i = start; i <= end; i++) {
                const record = listData[i];
                if (record && record[idKey]) {
                    selectionSet.add(record[idKey]);
                }
            }
        } else if (isModifier) {
            if (selectionSet.has(recordId)) {
                selectionSet.delete(recordId);
            } else {
                selectionSet.add(recordId);
            }
        } else {
            selectionSet = new Set([recordId]);
        }

        this[selectionKey] = Array.from(selectionSet);
        this[lastIndexKey] = index;
    }

    extractError(error) {
        return (
            (error && error.body && error.body.message) ||
            (error && error.message) ||
            'An unexpected error occurred.'
        );
    }

    showToast(title, message, variant = 'info') {
        this.dispatchEvent(
            new ShowToastEvent({
                title,
                message,
                variant
            })
        );
    }

    get filteredAssignedItems() {
        const decorated = this.assignedItems.map((item) => ({
            ...item,
            cardClass: this.selectedAssignedItemIds.includes(item.redemptionId)
                ? 'item-card item-card_selected'
                : 'item-card'
        }));
        if (this.assignedSearchTerm) {
            const term = this.assignedSearchTerm.toLowerCase();
            return decorated.filter((item) =>
                (item.itemId || '').toLowerCase().includes(term) ||
                (item.description || '').toLowerCase().includes(term)
            );
        }
        return decorated;
    }

    handleAssignedSearchChange(event) {
        this.assignedSearchTerm = event.target.value;
    }
}
