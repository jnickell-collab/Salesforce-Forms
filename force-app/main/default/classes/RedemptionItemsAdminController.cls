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

        List<Product2> products;
        String baseWhere = 'XC_ProductDivision__c = :divisionValue'
            + ' AND XC_Usage__c = \'Retail\''
            + ' AND (XC_ProductClass__c <> \'12\')'
            + ' AND ProductCode != null AND ProductCode != \'\''
            + ' AND IsActive = true';
        if (excludedCodes.isEmpty()) {
            products = Database.query(
                'SELECT Id, ProductCode, XC_S2kDescription__c '
                + 'FROM Product2 WHERE ' + baseWhere + ' ORDER BY ProductCode'
            );
        } else {
            products = Database.query(
                'SELECT Id, ProductCode, XC_S2kDescription__c '
                + 'FROM Product2 WHERE ' + baseWhere + ' AND ProductCode NOT IN :excludedCodes ORDER BY ProductCode'
            );
        }

        List<ProductPayload> result = new List<ProductPayload>();
        for (Product2 prod : products) {
            result.add(
                new ProductPayload(prod.Id, prod.ProductCode, prod.XC_S2kDescription__c)
            );
        }
        return result;
    }

    @AuraEnabled
    public static List<RedemptionItemPayload> getRedemptionItems(Integer divisionId, String promoTier) {
        if (divisionId == null) {
            return new List<RedemptionItemPayload>();
        }
        String soql = 'SELECT Id, SSG_ItemID__c, SSG_ItemDescription__c FROM SSG_RedemptionItems__c WHERE SSG_DivisionID__c = :divisionId';
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
                new RedemptionItemPayload(row.Id, row.SSG_ItemID__c, row.SSG_ItemDescription__c)
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
                    SSG_PromoTier__c = promoTier
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

        public ProductPayload() {}

        public ProductPayload(Id productId, String productCode, String description) {
            this.productId = productId;
            this.productCode = productCode;
            this.description = description;
        }
    }

    public class RedemptionItemPayload {
        @AuraEnabled public Id redemptionId;
        @AuraEnabled public String itemId;
        @AuraEnabled public String description;

        public RedemptionItemPayload() {}

        public RedemptionItemPayload(Id redemptionId, String itemId, String description) {
            this.redemptionId = redemptionId;
            this.itemId = itemId;
            this.description = description;
        }
    }

    public class ItemPayload {
        @AuraEnabled public String productCode;
        @AuraEnabled public String description;

        public ItemPayload() {}

        public ItemPayload(String productCode, String description) {
            this.productCode = productCode;
            this.description = description;
        }
    }
}
