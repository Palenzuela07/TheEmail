async function saveUserToFirebase(user) {
    const userRef = firebase.firestore().collection('users').doc(user.uid);
    
    const userData = {
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
        emailSettings: {
            showUnread: true,
            sortBy: 'date',
            theme: 'light'
        }
    };

    try {
        await userRef.set(userData, { merge: true });
        console.log('User profile saved successfully');
    } catch (error) {
        console.error('Error saving user profile:', error);
        throw error;
    }
}

async function getUserData(userId) {
    try {
        const doc = await firebase.firestore()
            .collection('users')
            .doc(userId)
            .get();
        
        return doc.exists ? doc.data() : null;
    } catch (error) {
        console.error('Error getting user data:', error);
        throw error;
    }
}

async function updateUserProfile(userId, data) {
    try {
        await firebase.firestore()
            .collection('users')
            .doc(userId)
            .update(data);
        
        console.log('Profile updated successfully');
    } catch (error) {
        console.error('Error updating profile:', error);
        throw error;
    }
} 