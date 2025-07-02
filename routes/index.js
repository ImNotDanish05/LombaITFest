const express = require('express');
const router = express.Router();

// Terms and Conditions
router.get('/TermsAndConditions', async (req, res) => {
    try {
        res.render('pages/TermsAndConditions.ejs'); 
    } catch (error) {
        console.error('Error rendering TermsAndConditions:', error);
        res.status(500).send('Something went wrong!'); 
    }
});

// Privacy Policy
router.get('/PrivacyPolicy', (req, res) => {
    try {
        res.render('pages/PrivacyPolicy'); 
    } catch (error) {
        console.error('Error rendering PrivacyPolicy:', error);
        res.status(500).send('Something went wrong!');
    }
});

// Credits
router.get('/Credits', (req, res) => {
    try {
        res.render('pages/Credits'); 
    } catch (error) {
        console.error('Error rendering Credits:', error);
        res.status(500).send('Something went wrong!');
    }
});

module.exports = router;
