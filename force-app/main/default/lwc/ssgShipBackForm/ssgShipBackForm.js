import { LightningElement, track } from 'lwc';

const CATEGORY_KEYS = [
    { key: 'homeOffice', label: 'Home Office Requests' },
    { key: 'trades', label: 'Trades' },
    { key: 'damageDefective', label: 'Damage/Defective' },
    { key: 'educationOther', label: 'Education/Other' }
];

export default class SsgShipBackForm extends LightningElement {
    totalBoxes = '';
    needPallet = '';
    completedBy = '';

    entryItemCode = '';
    entryQty = '';
    entryBoxNumber = '';
    entryCategory = '';

    @track itemsByCategory = {
        homeOffice: [],
        trades: [],
        damageDefective: [],
        educationOther: []
    };

    _nextId = 1;

    get palletOptions() {
        return [
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' }
        ];
    }

    get categoryOptions() {
        return CATEGORY_KEYS.map(c => ({ label: c.label, value: c.key }));
    }

    get categories() {
        return CATEGORY_KEYS.map(c => ({
            key: c.key,
            label: c.label,
            items: this.itemsByCategory[c.key],
            count: this.itemsByCategory[c.key].length,
            hasItems: this.itemsByCategory[c.key].length > 0
        }));
    }

    handleTotalBoxesChange(event) {
        this.totalBoxes = event.detail.value;
    }

    handlePalletChange(event) {
        this.needPallet = event.detail.value;
    }

    handleCompletedByChange(event) {
        this.completedBy = event.detail.value;
    }

    handleEntryItemCode(event) {
        this.entryItemCode = event.detail.value;
    }

    handleEntryQty(event) {
        this.entryQty = event.detail.value;
    }

    handleEntryBoxNumber(event) {
        this.entryBoxNumber = event.detail.value;
    }

    handleEntryCategory(event) {
        this.entryCategory = event.detail.value;
    }

    handleAddItem() {
        if (!this.entryItemCode || !this.entryQty || !this.entryBoxNumber || !this.entryCategory) {
            return;
        }

        const newItem = {
            id: this._nextId++,
            itemCode: this.entryItemCode,
            qty: Number(this.entryQty),
            boxNumber: Number(this.entryBoxNumber)
        };

        this.itemsByCategory = {
            ...this.itemsByCategory,
            [this.entryCategory]: [...this.itemsByCategory[this.entryCategory], newItem]
        };

        this.entryItemCode = '';
        this.entryQty = '';
        this.entryBoxNumber = '';
    }

    handleRemoveItem(event) {
        const itemId = Number(event.currentTarget.dataset.id);
        const updated = { ...this.itemsByCategory };
        for (const key of Object.keys(updated)) {
            updated[key] = updated[key].filter(i => i.id !== itemId);
        }
        this.itemsByCategory = updated;
    }
}
