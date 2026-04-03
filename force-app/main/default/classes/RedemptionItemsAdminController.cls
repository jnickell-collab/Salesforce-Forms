public with sharing class RedemptionItemsAdminController {
    @AuraEnabled
    public static List<ProductPayload> getAvailableProducts(Integer divisionId, String promoTier) {
        if (divisionId == null) {
            return new List<ProductPayload>();
        }

        String divisionValue = String.valueOf(divisionId);
        Set<String> excludedCodes = new Set<String>();
        String exclusionQuery = 'SELECT SSG_ItemID__c FROM SSG_RedemptionItems__c WHERE SSG_DivisionID__c = :divisionId AND SSG_ItemID__c != null';
        if (promoTier != null && promoTier != '') {
            exclusionQuery += ' AND SSG_PromoTier__c = :promoTier';
        } else {
            exclusionQuery += ' AND (SSG_PromoTier__c = null OR SSG_PromoTier__c = \'\')';
        }
        for (SSG_RedemptionItems__c existing : Database.query(exclusionQuery)) {
            excludedCodes.add(existing.SSG_ItemID__c);
        }

        List<PricebookEntry> entries;
        String baseWhere = 'XC_ExternalId__c LIKE \'%|01\''
            + ' AND Product2.XC_ProductDivision__c = :divisionValue'
            + ' AND Product2.IsActive = true'
            + ' AND Product2.XC_Usage__c = \'Retail\''
            + ' AND Product2.ProductCode != null AND Product2.ProductCode != \'\''
            + ' AND (Product2.XC_ProductClass__c <> \'12\')';
        if (excludedCodes.isEmpty()) {
            entries = Database.query(
                'SELECT Product2.Id, Product2.ProductCode, Product2.XC_S2kDescription__c, UnitPrice '
                + 'FROM PricebookEntry WHERE ' + baseWhere + ' ORDER BY Product2.ProductCode'
            );
        } else {
            entries = Database.query(
                'SELECT Product2.Id, Product2.ProductCode, Product2.XC_S2kDescription__c, UnitPrice '
                + 'FROM PricebookEntry WHERE ' + baseWhere + ' AND Product2.ProductCode NOT IN :excludedCodes ORDER BY Product2.ProductCode'
            );
        }

        List<ProductPayload> result = new List<ProductPayload>();
        for (PricebookEntry pe : entries) {
            result.add(
                new ProductPayload(pe.Product2.Id, pe.Product2.ProductCode, pe.Product2.XC_S2kDescription__c, pe.UnitPrice)
            );
        }
        return result;
    }

    @AuraEnabled
    public static List<RedemptionItemPayload> getRedemptionItems(Integer divisionId, String promoTier) {
        if (divisionId == null) {
            return new List<RedemptionItemPayload>();
        }
        String soql = 'SELECT Id, SSG_ItemID__c, SSG_ItemDescription__c, SSG_UnitPrice__c FROM SSG_RedemptionItems__c WHERE SSG_DivisionID__c = :divisionId';
        if (promoTier != null && promoTier != '') {
            soql += ' AND SSG_PromoTier__c = :promoTier';
        } else {
            soql += ' AND (SSG_PromoTier__c = null OR SSG_PromoTier__c = \'\')';
        }
        soql += ' ORDER BY Name';
        List<SSG_RedemptionItems__c> rows = Database.query(soql);
        List<RedemptionItemPayload> result = new List<RedemptionItemPayload>();
        for (SSG_RedemptionItems__c row : rows) {
            result.add(
                new RedemptionItemPayload(row.Id, row.SSG_ItemID__c, row.SSG_ItemDescription__c, row.SSG_UnitPrice__c)
            );
        }
        return result;
    }

    @AuraEnabled
    public static void addRedemptionItems(String itemsJson, Integer divisionId, String promoTier) {
        if (divisionId == null || itemsJson == null || itemsJson == '') {
            return;
        }
        List<ItemPayload> itemsToAdd = (List<ItemPayload>) JSON.deserialize(itemsJson, List<ItemPayload>.class);
        if (itemsToAdd == null || itemsToAdd.isEmpty()) {
            return;
        }
        Set<String> requestedCodes = new Set<String>();
        for (ItemPayload item : itemsToAdd) {
            if (item.productCode != null) {
                requestedCodes.add(item.productCode.trim());
            }
        }
        if (requestedCodes.isEmpty()) {
            return;
        }

        Set<String> existingCodes = new Set<String>();
        String dupeQuery = 'SELECT SSG_ItemID__c FROM SSG_RedemptionItems__c WHERE SSG_DivisionID__c = :divisionId AND SSG_ItemID__c IN :requestedCodes';
        if (promoTier != null && promoTier != '') {
            dupeQuery += ' AND SSG_PromoTier__c = :promoTier';
        } else {
            dupeQuery += ' AND (SSG_PromoTier__c = null OR SSG_PromoTier__c = \'\')';
        }
        for (SSG_RedemptionItems__c existing : Database.query(dupeQuery)) {
            existingCodes.add(existing.SSG_ItemID__c);
        }

        List<SSG_RedemptionItems__c> inserts = new List<SSG_RedemptionItems__c>();
        for (ItemPayload payload : itemsToAdd) {
            if (payload.productCode == null) {
                System.debug('Skipping: productCode is null');
                continue;
            }
            String normalizedCode = payload.productCode.trim();
            if ((normalizedCode == null || normalizedCode == '')) {
                System.debug('Skipping: normalizedCode is blank');
                continue;
            }
            if (existingCodes.contains(normalizedCode)) {
                System.debug('Skipping: duplicate code ' + normalizedCode);
                continue;
            }
            System.debug('Adding: ' + normalizedCode + ' for division ' + divisionId + ' and promoTier ' + promoTier);
            inserts.add(
                new SSG_RedemptionItems__c(
                    Name = normalizedCode,
                    SSG_ItemID__c = normalizedCode,
                    SSG_ItemDescription__c = payload.description,
                    SSG_DivisionID__c = divisionId,
                    SSG_PromoTier__c = promoTier,
                    SSG_UnitPrice__c = payload.unitPrice
                )
            );
        }
        if (!inserts.isEmpty()) {
            try {
                insert inserts;
                System.debug('Inserted ' + inserts.size() + ' redemption items.');
            } catch (Exception e) {
                System.debug('Insert failed: ' + e.getMessage());
                throw e;
            }
        } else {
            System.debug('No inserts to perform.');
        }
    }

    @AuraEnabled
    public static void removeRedemptionItems(List<Id> itemIds) {
        if (itemIds == null || itemIds.isEmpty()) {
            return;
        }
        List<SSG_RedemptionItems__c> toDelete = [
            SELECT Id
            FROM SSG_RedemptionItems__c
            WHERE Id IN :itemIds
        ];
        if (!toDelete.isEmpty()) {
            delete toDelete;
        }
    }

    public class ProductPayload {
        @AuraEnabled public Id productId;
        @AuraEnabled public String productCode;
        @AuraEnabled public String description;
        @AuraEnabled public Decimal unitPrice;

        public ProductPayload() {}

        public ProductPayload(Id productId, String productCode, String description, Decimal unitPrice) {
            this.productId = productId;
            this.productCode = productCode;
            this.description = description;
            this.unitPrice = unitPrice;
        }
    }

    public class RedemptionItemPayload {
        @AuraEnabled public Id redemptionId;
        @AuraEnabled public String itemId;
        @AuraEnabled public String description;
        @AuraEnabled public Decimal unitPrice;

        public RedemptionItemPayload() {}

        public RedemptionItemPayload(Id redemptionId, String itemId, String description, Decimal unitPrice) {
            this.redemptionId = redemptionId;
            this.itemId = itemId;
            this.description = description;
            this.unitPrice = unitPrice;
        }
    }

    public class ItemPayload {
        @AuraEnabled public String productCode;
        @AuraEnabled public String description;
        @AuraEnabled public Decimal unitPrice;

        public ItemPayload() {}

        public ItemPayload(String productCode, String description, Decimal unitPrice) {
            this.productCode = productCode;
            this.description = description;
            this.unitPrice = unitPrice;
        }
    }
}
