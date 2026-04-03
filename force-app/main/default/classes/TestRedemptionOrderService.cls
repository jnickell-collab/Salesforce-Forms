/**
 * Test class for RedemptionOrderService to isolate the customerId issue
 */
@isTest
public class TestRedemptionOrderService {
    
    @isTest
    static void testCustomerIdDeserialization() {
        // Create a test OrderRequest with customerId
        RedemptionOrderService.OrderRequest request = new RedemptionOrderService.OrderRequest();
        request.customerId = 'AAD7709';
        request.repNumber = 12345;
        request.formName = 'Milbon';
        
        // Create a test OrderLine
        RedemptionOrderService.OrderLine line = new RedemptionOrderService.OrderLine();
        line.itemId = 'TEST001';
        line.quantity = 1;
        line.unitPrice = 100.00;
        line.message = null;
        line.shipWithNext = null;
        
        request.lines = new List<RedemptionOrderService.OrderLine>{line};
        
        // Create a list of requests
        List<RedemptionOrderService.OrderRequest> requests = new List<RedemptionOrderService.OrderRequest>{request};
        
        // Test that the request is properly constructed
        System.assertEquals('AAD7709', request.customerId, 'customerId should be AAD7709');
        System.assertEquals(12345, request.repNumber, 'repNumber should be 12345');
        System.assertEquals('Milbon', request.formName, 'formName should be Milbon');
        System.assertEquals(1, request.lines.size(), 'Should have 1 line');
        
        // Test the submitOrders method with debug output
        Test.startTest();
        List<RedemptionOrderService.OrderResult> results = RedemptionOrderService.submitOrders(requests);
        Test.stopTest();
        
        // Verify we got a result
        System.assertNotEquals(null, results, 'Results should not be null');
        System.assertEquals(1, results.size(), 'Should have 1 result');
        
        RedemptionOrderService.OrderResult result = results[0];
        System.assertEquals(true, result.success, 'Order should be successful');
        System.assertNotEquals(null, result.headerId, 'Header ID should not be null');
        System.assertNotEquals(null, result.poNumber, 'PO Number should not be null');
    }
    
    @isTest
    static void testCustomerIdNullHandling() {
        // Test with null customerId
        RedemptionOrderService.OrderRequest request = new RedemptionOrderService.OrderRequest();
        request.customerId = null;
        request.repNumber = 12345;
        request.formName = 'Milbon';
        
        // Create a test OrderLine
        RedemptionOrderService.OrderLine line = new RedemptionOrderService.OrderLine();
        line.itemId = 'TEST001';
        line.quantity = 1;
        line.unitPrice = 100.00;
        line.message = null;
        line.shipWithNext = null;
        
        request.lines = new List<RedemptionOrderService.OrderLine>{line};
        
        List<RedemptionOrderService.OrderRequest> requests = new List<RedemptionOrderService.OrderRequest>{request};
        
        Test.startTest();
        List<RedemptionOrderService.OrderResult> results = RedemptionOrderService.submitOrders(requests);
        Test.stopTest();
        
        // Should fail with "Missing Customer ID" error
        System.assertNotEquals(null, results, 'Results should not be null');
        System.assertEquals(1, results.size(), 'Should have 1 result');
        
        RedemptionOrderService.OrderResult result = results[0];
        System.assertEquals(false, result.success, 'Order should fail');
        System.assert(result.message.contains('Missing Customer ID'), 'Should contain Missing Customer ID error');
    }

    @isTest
    static void testSpecialLinesPersistPromoTierAndLoadAsSpecial() {
        RedemptionOrderService.OrderRequest request = new RedemptionOrderService.OrderRequest();
        request.customerId = 'AAD7710';
        request.repNumber = 12345;
        request.formName = 'Milbon';
        request.customerType = 'DIAMOND';
        request.formStatus = 'SAVED';
        request.shipWithNext = 'N';
        request.shipToStore = 'Y';
        request.headerMessage = 'Boston Store';

        RedemptionOrderService.OrderLine standardLine = new RedemptionOrderService.OrderLine();
        standardLine.itemId = 'STD001';
        standardLine.quantity = 1;
        standardLine.unitPrice = 100;
        standardLine.isSpecial = false;

        RedemptionOrderService.OrderLine specialLine = new RedemptionOrderService.OrderLine();
        specialLine.itemId = 'SPC001';
        specialLine.quantity = 30;
        specialLine.unitPrice = 0;
        specialLine.isSpecial = true;

        request.lines = new List<RedemptionOrderService.OrderLine>{ standardLine, specialLine };

        Test.startTest();
        List<RedemptionOrderService.OrderResult> results =
            RedemptionOrderService.submitOrders(new List<RedemptionOrderService.OrderRequest>{ request });
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return one result');
        System.assertEquals(true, results[0].success, 'Order should save successfully');
        System.assertNotEquals(null, results[0].headerId, 'Header Id should be set');

        List<RedemptionFormDetails__c> savedDetails = [
            SELECT ItemID__c, SSG_PromoTier__c
            FROM RedemptionFormDetails__c
            WHERE PONumber__c = :results[0].poNumber
            ORDER BY ItemID__c
        ];

        System.assertEquals(2, savedDetails.size(), 'Should save both standard and special lines');
        System.assertEquals(null, savedDetails[0].SSG_PromoTier__c, 'Standard line should not have promo tier');
        System.assertEquals('Diamond', savedDetails[1].SSG_PromoTier__c, 'Special line should persist Diamond promo tier');

        Test.startTest();
        RedemptionOrderService.LoadFormResult loaded = RedemptionOrderService.loadFormWithDetails(results[0].headerId);
        Test.stopTest();

        System.assertEquals(true, loaded.success, 'Load should succeed');
        System.assertEquals('N', loaded.header.shipWithNext, 'Header should persist ship with next');
        System.assertEquals('Y', loaded.header.shipToStore, 'Header should persist ship to store');
        System.assertEquals('Boston Store', loaded.header.headerMessage, 'Header should persist store message');
        Integer loadedSpecial = 0;
        Integer loadedStandard = 0;
        for (RedemptionOrderService.LoadedDetail d : loaded.details) {
            if (d.isSpecial == true) {
                loadedSpecial++;
                System.assertEquals('Diamond', d.promoTier, 'Special detail should return Diamond promo tier');
            } else {
                loadedStandard++;
                System.assertEquals(null, d.promoTier, 'Standard detail should not return promo tier');
            }
        }
        System.assertEquals(1, loadedSpecial, 'Exactly one detail should be special');
        System.assertEquals(1, loadedStandard, 'Exactly one detail should be standard');
    }
}