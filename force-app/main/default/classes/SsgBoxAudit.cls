public with sharing class SsgBoxAudit {
    @AuraEnabled(cacheable=false)
    public static List<Map<String, Object>> getBoxAudit(String barcode) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('https://onemuletorulethemall-4oqos0.e6uj5k.usa-e2.cloudhub.io/whs/boxaudit');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(new Map<String, Object>{
            'Token' => 'SSG1520',
            'Barcode' => barcode
        }));
        Http http = new Http();
        HttpResponse res = http.send(req);
        if (res.getStatusCode() == 200) {
            Object raw = JSON.deserializeUntyped(res.getBody());
            if (raw instanceof List<Object>) {
                List<Object> rawList = (List<Object>)raw;
                List<Map<String, Object>> result = new List<Map<String, Object>>();
                for (Object o : rawList) {
                    if (o instanceof Map<String, Object>) {
                        result.add((Map<String, Object>)o);
                    }
                }
                return result;
            } else {
                return new List<Map<String, Object>>();
            }
        } else {
            throw new AuraHandledException('Box Audit API error: ' + res.getStatus());
        }
    }
}
