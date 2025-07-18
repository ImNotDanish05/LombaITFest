const express = require('express');
const router = express.Router();
const { checkSession, authSession } = require('../controllers/authSession');

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

// Penjelasan Nama dan Logo
router.get('/penjelasannamadanlogo', async (req, res) => {
    try {
        const user = await checkSession(req);
        res.render('pages/penjelasannamadanlogo'
        , {
            user: user || null // Pastikan user tidak undefined
        }
        ); 
    } catch (error) {
        console.error('Error rendering Credits:', error);
        res.status(500).send('Something went wrong!');
    }
});

// faq
router.get('/faq', (req, res) => {
    try {
        res.render('pages/faq'); 
    } catch (error) {
        console.error('Error rendering Credits:', error);
        res.status(500).send('Something went wrong!');
    }
});

// Tutorial
router.get('/tutorial', (req, res) => {
    try {
        res.render('pages/tutorial'); 
    } catch (error) {
        console.error('Error rendering tutorial:', error);
        res.status(500).send('Something went wrong!');
    }
});

module.exports = router;
