UPDATE `phone_change_requests` SET `pendingPhoneNormalized` = `newPhoneNormalized` WHERE `status` = 'pending' AND `pendingPhoneNormalized` IS NULL;
