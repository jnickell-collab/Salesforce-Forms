@isTest
private class TestRedemptionItemsAdminController {
    @testSetup
    static void setupTestData() {
        List<Product2> products = new List<Product2>{
            new Product2(
                Name = 'Milbon Item One',
                ProductCode = 'MILBON-1',
                XC_ProductDivision__c = '40',
                XC_S2kDescription__c = 'Test description one',
                IsActive = true
            ),
            new Product2(
                Name = 'Milbon Item Two',
                ProductCode = 'MILBON-2',
                XC_ProductDivision__c = '40',
                XC_S2kDescription__c = 'Test description two',
                IsActive = true
            )
        };
        insert products;
    }

    @isTest
    static void testAddAndRemoveItemsFlow() {
        RedemptionItemsAdminController.ItemPayload payload =
            new RedemptionItemsAdminController.ItemPayload('MILBON-1', 'Test description one');
        Test.startTest();
        RedemptionItemsAdminController.addRedemptionItems(
            new List<RedemptionItemsAdminController.ItemPayload>{ payload },
            40
        );
        List<RedemptionItemsAdminController.RedemptionItemPayload> assigned =
            RedemptionItemsAdminController.getRedemptionItems(40);
        System.assertEquals(1, assigned.size(), 'One item should be assigned after adding.');

        List<RedemptionItemsAdminController.ProductPayload> availableAfterAdd =
            RedemptionItemsAdminController.getAvailableProducts(40);
        System.assertEquals(1, availableAfterAdd.size(), 'Remaining available product should be one.');

        RedemptionItemsAdminController.removeRedemptionItems(
            new List<Id>{ assigned[0].redemptionId }
        );

        List<RedemptionItemsAdminController.RedemptionItemPayload> assignedAfterRemoval =
            RedemptionItemsAdminController.getRedemptionItems(40);
        System.assertEquals(0, assignedAfterRemoval.size(), 'No items should remain after removal.');

        List<RedemptionItemsAdminController.ProductPayload> availableAfterRemove =
            RedemptionItemsAdminController.getAvailableProducts(40);
        System.assertEquals(2, availableAfterRemove.size(), 'Both products should be available again.');
        Test.stopTest();
    }
}
